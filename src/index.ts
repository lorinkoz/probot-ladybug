import { Application, Context } from "probot";
import createScheduler from "probot-scheduler";
import metadata from "probot-metadata";
import moment from "moment";

interface AppConfig {
  peer_labels?: boolean;
  duplicated_issues?: false | DuplicatedIssuesConfig;
  scheduled_checks?: ScheduledChecksConfig;
}

interface DuplicatedIssuesConfig {
  label: string;
  chain_close?: boolean;
  chain_reopen?: boolean;
}

interface ScheduledChecksConfig {
  [propName: string]: CheckConfig;
}

interface CheckConfig {
  if_type?: "issue" | "pr";
  if_state?: "open" | "closed";
  if_created?: string;
  if_updated?: string;
  if_label?: string | string[];
  if_no_label?: string | string[];
  if_assignee?: "no" | string;
  if_comments?: number;
  add_labels?: string | string[];
  remove_labels?: string | string[];
  replace_labels?: string | string[];
  comment?: string;
  set_state?: "open" | "closed";
  set_locked?: false | "off-topic" | "too heated" | "resolved" | "spam";
  add_assignees?: string | string[];
  remove_assignees?: string | string[];
}

const configPath = "ladybug.yml";
const defaultConfig: AppConfig = {
  peer_labels: true,
  duplicated_issues: {
    label: "Status: Duplicated",
    chain_close: true,
    chain_reopen: true,
  },
};

export = (app: Application) => {
  app.log("Ladybug on duty!");
  createScheduler(app, {
    interval: 5 * 60 * 1000, // 5 minutes
  });

  app.on("schedule.repository", checkScheduledTasks);
  app.on("issues.labeled", removePeerLabels);
  app.on("issues.closed", checkChainClosing);
  app.on("issues.reopened", checkChainReopening);
  app.on("issue_comment.created", checkDuplicateIssue);
  app.on("issue_comment.edited", checkDuplicateIssue);
  app.on("issue_comment.deleted", checkDuplicateIssue);

  // Scheduled tasks
  async function checkScheduledTasks(context: Context) {
    const functions: Array<() => void> = [],
      config: AppConfig = (await context.config(configPath, defaultConfig)) as AppConfig;

    for (let checkName in config.scheduled_checks) {
      const check = (config.scheduled_checks as ScheduledChecksConfig)[checkName];
      app.log(`Processing task ${checkName}.`);

      functions.push(async () => {
        const { owner, repo } = context.repo(),
          chunks: string[] = [`repo:${owner}/${repo}`];

        if (check.if_type) {
          chunks.push(`type:${check.if_type}`);
        }
        if (check.if_state) {
          chunks.push(`state:${check.if_state}`);
        }
        if (check.if_created) {
          chunks.push(
            `created:<${moment()
              .subtract(...check.if_created.split(" "))
              .format(moment.defaultFormatUtc)}`
          );
        }
        if (check.if_updated) {
          chunks.push(
            `updated:<${moment()
              .subtract(...check.if_updated.split(" "))
              .format(moment.defaultFormatUtc)}`
          );
        }
        if (check.if_label) {
          const labels = Array.isArray(check.if_label) ? check.if_label : [check.if_label];
          for (let label of labels) {
            chunks.push(label === "no" ? `no:label` : `label:${label}`);
          }
        }
        if (check.if_no_label) {
          const labels = Array.isArray(check.if_no_label) ? check.if_no_label : [check.if_no_label];
          for (let label of labels) {
            chunks.push(label === "no" ? `-no:label` : `-label:${label}`);
          }
        }
        if (check.if_assignee) {
          chunks.push(check.if_assignee == "no" ? `no:assignee` : `assignee:${check.if_assignee}`);
        }
        if (typeof check.if_comments === "number") {
          chunks.push(`comments:<=${check.if_comments}`);
        }

        const q = chunks.join(" "),
          searchResults = await context.github.search.issuesAndPullRequests({ q });
        app.log(`Query: >>> ${q} <<< returned [${searchResults.data.items.map((x) => x.number).join(", ")}].`);

        await Promise.all(
          searchResults.data.items.map(async (issue) => {
            if (check.remove_labels) {
              const labels = issue.labels.map((x) => x.name),
                targetLabels = Array.isArray(check.remove_labels) ? check.remove_labels : [check.remove_labels];
              for (let label of targetLabels) {
                if (!labels.includes(label)) {
                  labels.push(label);
                }
              }
              await context.github.issues.replaceLabels({
                owner,
                repo,
                issue_number: issue.number,
                labels: labels,
              });
            }
            if (check.add_labels) {
              await context.github.issues.addLabels({
                owner,
                repo,
                issue_number: issue.number,
                labels: Array.isArray(check.add_labels) ? check.add_labels : [check.add_labels],
              });
            }
            if (check.replace_labels) {
              await context.github.issues.replaceLabels({
                owner,
                repo,
                issue_number: issue.number,
                labels: Array.isArray(check.replace_labels) ? check.replace_labels : [check.replace_labels],
              });
            }
            if (check.comment) {
              const replacements = {
                "${AUTHOR}": issue.user.login,
                "${ASSIGNEE}": (issue.assignee as any)?.login || "", // assignee is considered null always, why?
              };
              let commentBody = check.comment;
              for (let placeholder in replacements) {
                commentBody = commentBody.split(placeholder).join(replacements[placeholder]);
              }

              await context.github.issues.createComment({
                owner,
                repo,
                issue_number: issue.number,
                body: commentBody,
              });
            }
            if (check.set_state) {
              await context.github.issues.update({
                owner,
                repo,
                issue_number: issue.number,
                state: check.set_state,
              });
            }
            if (check.set_locked) {
              if (typeof check.set_locked === "boolean") {
                await context.github.issues.unlock({
                  owner,
                  repo,
                  issue_number: issue.number,
                });
              } else {
                await context.github.issues.lock({
                  owner,
                  repo,
                  issue_number: issue.number,
                  lock_reason: check.set_locked,
                });
              }
            }
            if (check.remove_assignees) {
              await context.github.issues.removeAssignees({
                owner,
                repo,
                issue_number: issue.number,
                assignees: Array.isArray(check.remove_assignees) ? check.remove_assignees : [check.remove_assignees],
              });
            }
            if (check.add_assignees) {
              await context.github.issues.addAssignees({
                owner,
                repo,
                issue_number: issue.number,
                assignees: Array.isArray(check.add_assignees) ? check.add_assignees : [check.add_assignees],
              });
            }
          })
        );
      });
    }

    await Promise.all(functions.map((x) => x()));
  }

  // Removes peer labels
  async function removePeerLabels(context: Context) {
    const config: AppConfig = (await context.config(configPath, defaultConfig)) as AppConfig,
      { label, issue } = context.payload,
      peerRegex = /^(.+:)/,
      match = label.name.match(peerRegex);

    if (match && config.peer_labels) {
      const labels = issue.labels.filter((x) => !x.name.startsWith(match[1])).map((x) => x.name);
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
  async function checkDuplicateIssue(context: Context) {
    const config: AppConfig = (await context.config(configPath, defaultConfig)) as AppConfig,
      dupRegex = /^Duplicate of #(\d+)/,
      { issue, comment, action, changes } = context.payload;

    // Mark issue as duplicate
    async function markDuplicate(duplicateOf: number) {
      if (!!config.duplicated_issues) {
        app.log(`Marking issue #${issue.number} as dup of #${duplicateOf}.`);
        await metadata(context).set("duplicateOf", duplicateOf);
        await context.github.issues.replaceLabels(
          context.issue({
            labels: [config.duplicated_issues.label],
          })
        );
      }
    }

    // Unmark issue as duplicate
    async function unmarkDuplicate(duplicateOf: number) {
      if (!!config.duplicated_issues) {
        app.log(`Unmarking issue #${issue.number} as dup of #${duplicateOf}.`);
        await metadata(context).set("duplicateOf", undefined);
        await context.github.issues.removeLabel(
          context.issue({
            name: config.duplicated_issues.label,
          })
        );
      }
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
  async function checkChainClosing(context: Context) {
    const config: AppConfig = (await context.config(configPath, defaultConfig)) as AppConfig,
      { issue } = context.payload,
      { owner, repo } = context.repo(),
      q =
        `is:issue is:open ` +
        `label:"${(config.duplicated_issues as DuplicatedIssuesConfig).label}" ` +
        `repo:${owner}/${repo}`,
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
          return null;
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
  async function checkChainReopening(context: Context) {
    const config: AppConfig = (await context.config(configPath, defaultConfig)) as AppConfig;
    if ("label" in (config.duplicated_issues as DuplicatedIssuesConfig)) {
      const { issue } = context.payload,
        { owner, repo } = context.repo(),
        q =
          `is:issue is:closed ` +
          `label:"${(config.duplicated_issues as DuplicatedIssuesConfig).label}" ` +
          `repo:${owner}/${repo}`,
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
            return null;
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
  }
};
