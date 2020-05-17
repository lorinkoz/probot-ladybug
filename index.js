const createScheduler = require("probot-scheduler");
const moment = require("moment");

const configPath = "ladybug.yml",
  checkInterval = 5 * 60 * 1000,
  defaultConfig = {
    labels: {
      unconfirmed: "Status: Needs reproducing",
      confirmed: "Status: Confirmed",
      duplicated: "Status: Duplicated",
    },
    timeouts: {
      markUnconfirmed: 5, // minutes
      firstComment: 10 * 60, // minutes (10 hours)
    },
  };

module.exports = (app) => {
  app.log("Ladybug on duty!");
  createScheduler(app, {
    interval: checkInterval,
  });

  // Periodic housekeeping
  app.on("schedule.repository", async (context) => {
    const config = await context.config(configPath, defaultConfig);
    const { owner, repo } = context.repo();
    const searchResults = await context.github.search.issues({
      q: `no:label" repo:${owner}/${repo}`,
    });

    await Promise.all(
      searchResults.data.items.map(async (issue) => {
        // Marking unconfirmed
        if (
          issue.state == "open" &&
          moment(issue.created_at).add(config.timeouts.markUnconfirmed) <
            moment() &&
          !issue.labels.length
        ) {
          issue = context.repo(issue);
          const { owner, repo, number } = issue;

          app.log(`Marking issue #${issue.number} as unconfirmed.`);

          context.github.issues.addLabels({
            owner,
            repo,
            number,
            labels: [config.labels.unconfirmed],
          });
        }

        // Commenting to draw attention
        if (
          issue.state == "open" &&
          moment(issue.created_at).add(config.timeouts.firstComment) <
            moment() &&
          !issue.comments &&
          !issue.assignee
        ) {
          issue = context.repo(issue);
          const { owner, repo, number } = issue;

          app.log(`Commenting on #${issue.number} for the first time.`);

          context.github.issues.createComment({
            owner,
            repo,
            number,
            body: "Buzzing in to let you know about this report.",
          });
        }
      })
    );
  });

  // Removing stale labels
  app.on("issues.labeled", async (context) => {
    const config = await context.config(configPath, defaultConfig);
    app.log(`Checking labeled issue #${context.payload.issue.number}.`);

    // Removing 'unconfirmed' if 'confirmed' was added
    if (
      context.payload.label.name == config.labels.confirmed &&
      context.payload.issue.labels.filter(
        (x) => x.name == config.labels.unconfirmed
      ).length
    ) {
      app.log(
        `Removing "${config.labels.unconfirmed}" from labels on issue #${context.payload.issue.number}.`
      );
      context.github.issues.removeLabel(
        context.issue({
          name: config.labels.unconfirmed,
        })
      );
    }
    // Removing 'confirmed' if 'unconfirmed' was added
    else if (
      context.payload.label.name == config.labels.unconfirmed &&
      context.payload.issue.labels.filter(
        (x) => x.name == config.labels.confirmed
      ).length
    ) {
      app.log(
        `Removing "${config.labels.confirmed}" from labels on issue #${context.payload.issue.number}.`
      );
      context.github.issues.removeLabel(
        context.issue({
          name: config.labels.confirmed,
        })
      );
    }
  });

  // Labelling / unlabelling as duplicate
  app.on(
    ["issue_comment.created", "issue_comment.edited", "issue_comment.deleted"],
    async (context) => {
      const config = await context.config(configPath, defaultConfig);

      if (context.payload.issue.state == "open") {
        const eventResults = await context.github.issues.listEvents(
          context.issue({
            issue_number: context.payload.issue.number,
            per_page: 100,
          })
        );

        app.log(
          `Checking comment action on issue #${context.payload.issue.number}.`
        );
        const scopedEvents = eventResults.data.filter((x) =>
          ["marked_as_duplicate", "unmarked_as_duplicate"].includes(x.event)
        );
        const targetEvent =
          scopedEvents.length && scopedEvents.length < 100
            ? scopedEvents[scopedEvents.length - 1]
            : null;

        if (scopedEvents.length >= 100) {
          app.log(
            `Not pursuing any action on issue #${context.payload.issue.number}. Too many events to process.`
          );
        } else if (!targetEvent) {
          app.log(
            `Not pursuing any action on issue #${context.payload.issue.number}. No interesting events.`
          );
        }

        // Labelling as duplicate
        if (
          targetEvent &&
          targetEvent.event == "marked_as_duplicate" &&
          !context.payload.issue.labels.filter(
            (x) => x.name == config.labels.duplicated
          ).length
        ) {
          app.log(
            `Labelling issue #${context.payload.issue.number} as duplicate.`
          );
          await context.github.issues.replaceLabels(
            context.issue({
              labels: [config.labels.duplicated],
            })
          );
        }

        // Unlabelling as duplicate
        if (
          targetEvent &&
          targetEvent.event == "unmarked_as_duplicate" &&
          context.payload.issue.labels.filter(
            (x) => x.name == config.labels.duplicated
          ).length
        ) {
          app.log(
            `Unlabelling issue #${context.payload.issue.number} as duplicate.`
          );
          context.github.issues.removeLabel(
            context.issue({
              name: config.labels.duplicated,
            })
          );
        }
      }
    }
  );

  // Closing duplicated issues together
  app.on("issue.closed", async (context) => {});

  // Reopening duplicated issues together
  app.on("issue.reopened", async (context) => {});
};
