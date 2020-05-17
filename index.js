const createScheduler = require("probot-scheduler");
const metadata = require("probot-metadata");
const moment = require("moment");

const configPath = "ladybug.yml",
  defaultConfig = {
    labels: {
      confirmed: "Status: Confirmed",
      duplicated: "Status: Duplicated",
      unconfirmed: "Status: Needs reproducing",
    },
    timeouts: {
      unchimed: 10,
      unfollowed: 48,
      unlabeled: 1,
    },
  };

module.exports = (app) => {
  app.log("Ladybug on duty!");
  createScheduler(app, {
    interval: 5 * 60 * 1000, // 5 minutes
  });

  app.on("schedule.repository", periodicCheck);
  app.on("issues.labeled", removePeerLabels);
  app.on("issues.closed", checkChainClosing);
  app.on("issues.reopened", checkChainReopening);
  app.on("issue_comment.created", checkDuplicateIssue);
  app.on("issue_comment.edited", checkDuplicateIssue);
  app.on("issue_comment.deleted", checkDuplicateIssue);

  // Tasks of periodic housekeeping
  async function periodicCheck(context) {
    await Promise.all([checkUnlabelled(), checkUnchimed(), checkUnfollowed()]);

    async function checkUnlabelled() {
      const config = await context.config(configPath, defaultConfig),
        { owner, repo } = context.repo(),
        q =
          `is:issue is:open no:label ` +
          `created:<${moment().subtract(config.timeouts.unlabeled, "hours").format(moment.defaultFormatUtc)} ` +
          `repo:${owner}/${repo}`,
        searchResults = await context.github.search.issuesAndPullRequests({ q });

      await Promise.all(
        searchResults.data.items.map(async (issue) => {
          app.log(`Declaring issue #${issue.number} as unconfirmed.`);
          await context.github.issues.addLabels({
            owner,
            repo,
            issue_number: issue.number,
            labels: [config.labels.unconfirmed],
          });
        })
      );
    }

    async function checkUnchimed() {
      const config = await context.config(configPath, defaultConfig),
        { owner, repo } = context.repo(),
        q =
          `is:issue is:open no:assignee comments:0 ` +
          `created:<${moment().subtract(config.timeouts.unchimed, "hours").format(moment.defaultFormatUtc)} ` +
          `repo:${owner}/${repo}`,
        searchResults = await context.github.search.issuesAndPullRequests({ q });

      await Promise.all(
        searchResults.data.items.map(async (issue) => {
          app.log(`Chiming on #${issue.number} for the first time.`);
          await context.github.issues.createComment({
            owner,
            repo,
            issue_number: issue.number,
            body: "Buzzing in to put this report in your radar.",
          });
        })
      );
    }

    async function checkUnfollowed() {
      const config = await context.config(configPath, defaultConfig),
        { owner, repo } = context.repo(),
        q =
          `is:issue is:open ` +
          `updated:<${moment().subtract(config.timeouts.unfollowed, "hours").format(moment.defaultFormatUtc)} ` +
          `repo:${owner}/${repo}`,
        searchResults = await context.github.search.issuesAndPullRequests({ q });

      await Promise.all(
        searchResults.data.items.map(async (issue) => {
          app.log(`Following up on #${issue.number}.`);
          await context.github.issues.createComment({
            owner,
            repo,
            issue_number: issue.number,
            body: issue.assignee ? `@${issue.assignee.login} Any news on this one?` : `Any news on this one?`,
          });
        })
      );
    }
  }

  // Removes peer labels
  async function removePeerLabels(context) {
    const peerRegex = /^(.*):/,
      { label, issue } = context.payload,
      match = label.name.match(peerRegex);

    if (match) {
      const labels = issue.labels.filter((x) => !x.name.match(peerRegex)).map((x) => x.name);
      if (!labels.includes(label.name)) {
        labels.push(label.name);
      }
      if (labels.length) {
        await context.github.issues.replaceLabels(
          context.issue({
            labels,
          })
        );
      }
    }
  }

  // Checks created / edited / deleted issues for duplicate marking
  async function checkDuplicateIssue(context) {
    const config = await context.config(configPath, defaultConfig),
      dupRegex = /^Duplicate of #(\d+)/,
      { issue, comment, action, changes } = context.payload;

    // Mark issue as duplicate
    async function markDuplicate(duplicateOf) {
      app.log(`Marking issue #${issue.number} as dup of #${duplicateOf}.`);
      await metadata(context).set("duplicateOf", duplicateOf);
      await context.github.issues.replaceLabels(
        context.issue({
          labels: [config.labels.duplicated],
        })
      );
    }

    // Unmark issue as duplicate
    async function unmarkDuplicate(duplicateOf) {
      app.log(`Unmarking issue #${issue.number} as dup of #${duplicateOf}.`);
      await metadata(context).set("duplicateOf", undefined);
      await context.github.issues.removeLabel(
        context.issue({
          name: config.labels.duplicated,
        })
      );
    }

    if (issue.state == "open" && action == "created") {
      const match = comment.body.match(dupRegex);
      if (match) {
        markDuplicate(match[1]);
      }
    } else if (issue.state == "open" && action == "edited") {
      const matchBefore = changes.body && changes.body.from.match(dupRegex),
        matchAfter = comment.body.match(dupRegex);
      if (matchAfter) {
        markDuplicate(matchAfter[1]);
      } else if (matchBefore) {
        unmarkDuplicate(matchBefore[1]);
      }
    } else if (issue.state == "open" && action == "deleted") {
      const match = comment.body.match(dupRegex);
      if (match) {
        unmarkDuplicate(match[1]);
      }
    }
  }

  // Checks closed issue for chain closing
  async function checkChainClosing(context) {
    const config = await context.config(configPath, defaultConfig),
      { issue } = context.payload,
      { owner, repo } = context.repo(),
      q = `is:issue is:open label:"${config.labels.duplicated}" repo:${owner}/${repo}`,
      searchResults = await context.github.search.issuesAndPullRequests({ q });

    const chainClosed = (
      await Promise.all(
        searchResults.data.items.map(async (otherIssue) => {
          otherIssue = context.repo(otherIssue);
          const duplicateOf = await metadata(context, otherIssue).get("duplicateOf");

          if (duplicateOf && issue.number == parseInt(duplicateOf)) {
            app.log(`Chain closing issue #${otherIssue.number}.`);
            await context.github.issues.update({
              owner,
              repo,
              issue_number: otherIssue.number,
              state: "closed",
            });
            return `#${otherIssue.number}`;
          }
        })
      )
    ).filter((x) => x);

    if (chainClosed.length) {
      await context.github.issues.createComment(
        context.issue({
          body: `Closed other issues that were marked as duplicates of this one: ${chainClosed.join(", ")}`,
        })
      );
    }
  }

  // Checks reopened issue for chain reopening
  async function checkChainReopening(context) {
    const config = await context.config(configPath, defaultConfig),
      { issue } = context.payload,
      { owner, repo } = context.repo(),
      q = `is:issue is:closed label:"${config.labels.duplicated}" repo:${owner}/${repo}`,
      searchResults = await context.github.search.issuesAndPullRequests({ q });

    const chainReopened = (
      await Promise.all(
        searchResults.data.items.map(async (otherIssue) => {
          otherIssue = context.repo(otherIssue);
          const duplicateOf = await metadata(context, otherIssue).get("duplicateOf");

          if (duplicateOf && issue.number == parseInt(duplicateOf)) {
            app.log(`Chain reopening issue #${otherIssue.number}.`);
            await context.github.issues.update({
              owner,
              repo,
              issue_number: otherIssue.number,
              state: "open",
            });
            return `#${otherIssue.number}`;
          }
        })
      )
    ).filter((x) => x);

    if (chainReopened.length) {
      await context.github.issues.createComment(
        context.issue({
          body: `Reopened other issues that were marked as duplicates of this one: ${chainReopened.join(", ")}`,
        })
      );
    }
  }
};
