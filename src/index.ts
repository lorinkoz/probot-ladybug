import { Application, Context } from "probot";
import createScheduler from "probot-scheduler";
import metadata from "probot-metadata";
import commands from "probot-commands";
import moment from "moment";

interface AppConfig {
  peer_labels?: boolean;
  duplicated_issues?: false | DuplicatedIssuesConfig;
  scheduled_tasks?: ScheduledTasksConfig;
  mark_actions?: MarkConfig;
}

interface DuplicatedIssuesConfig {
  label: string;
  chain_close?: boolean;
  chain_reopen?: boolean;
}

interface ScheduledTasksConfig {
  [propName: string]: TaskConfig;
}

interface MarkConfig {
  [propName: string]: TaskActionSet;
}

interface TaskQuery {
  if_type?: "issue" | "pr";
  if_state?: "open" | "closed";
  if_created?: string;
  if_updated?: string;
  if_label?: string | string[];
  if_no_label?: string | string[];
  if_author?: string;
  if_not_author?: string;
  if_assignee?: "no" | string;
  if_not_assigned?: string;
  if_comments?: number;
  if_review?: "none" | "required" | "approved" | "changes_requested";
  if_reviewed_by?: string;
  if_linked?: "issue" | "pr";
  if_no_linked?: "issue" | "pr";
}

interface TaskActionSet {
  add_labels?: string | string[];
  remove_labels?: string | string[];
  replace_labels?: string | string[];
  comment?: string;
  set_state?: "open" | "closed";
  set_locked?: false | "off-topic" | "too heated" | "resolved" | "spam";
  add_assignees?: string | string[];
  remove_assignees?: "all" | string | string[];
}

interface TaskConfig extends TaskQuery, TaskActionSet {}

interface TaskResult {
  task: string;
  result:
    | "error"
    | {
        query: string;
        found: boolean;
      };
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
    interval: 15 * 60 * 1000, // 15 minutes
  });

  commands(app, "checktask", async (context, command) => {
    const config: AppConfig = (await context.config(configPath, defaultConfig)) as AppConfig,
      targetTasks = command.arguments?.split(/\s+/) || Object.keys(config.scheduled_tasks || {}),
      taskResults: TaskResult[] = [];
    for (let taskName of targetTasks) {
      const q = await buildTaskQuery(config.scheduled_tasks?.[taskName], context);

      if (q) {
        const searchResults = await context.github.search.issuesAndPullRequests({ q }),
          found = searchResults.data.items.some((x) => x.number == context.payload.issue.number);
        taskResults.push({ task: taskName, result: { found, query: q } });
      } else {
        taskResults.push({ task: taskName, result: "error" });
      }
    }

    const commentChunks: string[] = [];
    for (let tr of taskResults) {
      if (tr.result == "error") {
        commentChunks.push(`| \`${tr.task}\` | Not found in configuration | |`);
      } else {
        commentChunks.push(
          `| \`${tr.task}\` | \`${tr.result.query}\` | ${tr.result.found ? ":heavy_check_mark:" : ":x:"} |`
        );
      }
    }
    if (commentChunks.length) {
      context.github.issues.createComment(
        context.issue({
          body: "| Task | Query | Found |\n" + "| - | - | - |\n" + commentChunks.join("\n"),
        })
      );
    } else {
      context.github.issues.createComment(
        context.issue({
          body: "`/checktask` couldn't find any scheduled task.",
        })
      );
    }
  });

  commands(app, "trytask", async (context, command) => {
    const config: AppConfig = (await context.config(configPath, defaultConfig)) as AppConfig,
      actionSet = config.scheduled_tasks?.[command.arguments];

    if (!actionSet) {
      context.github.issues.createComment(
        context.issue({
          body: "`/trytask` couldn't find the target scheduled task.",
        })
      );
    } else {
      const executor = await buildTaskExecutor(actionSet, context);
      if (executor) {
        executor(context.payload.issue);
      }
    }
  });

  commands(app, "mark", async (context, command) => {
    const config: AppConfig = (await context.config(configPath, defaultConfig)) as AppConfig,
      markActions = config.mark_actions || {},
      targetMarks = command.arguments?.split(/\s+/);

    const errorChunks: string[] = [];
    for (let markName of targetMarks) {
      const actionSet = markActions[markName];
      if (!actionSet) {
        errorChunks.push(markName);
      } else {
        const executor = await buildTaskExecutor(actionSet, context);
        if (executor) {
          executor(context.payload.issue);
        }
      }
    }

    if (errorChunks.length) {
      context.github.issues.createComment(
        context.issue({
          body: `\`/mark\` couldn't find these keys in configuration: ${errorChunks.map((x) => `\`${x}\``).join(", ")}`,
        })
      );
    }
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

    for (let taskName in config.scheduled_tasks) {
      app.log(`Processing task ${taskName}.`);
      functions.push(async () => {
        const q = await buildTaskQuery(config.scheduled_tasks?.[taskName], context),
          executor = await buildTaskExecutor(config.scheduled_tasks?.[taskName], context);

        if (q && executor) {
          const searchResults = await context.github.search.issuesAndPullRequests({ q });

          app.log(`Query: ${q} -> [${searchResults.data.items.map((x) => x.number).join(", ")}].`);
          await Promise.all(searchResults.data.items.map(executor));
        }
      });
    }

    await Promise.all(functions.map((x) => x()));
  }

  // Builds query for schedule task
  async function buildTaskQuery(task: TaskQuery | null | undefined, context) {
    const { owner, repo } = context.repo(),
      chunks: string[] = [`repo:${owner}/${repo}`];

    if (task) {
      if (task.if_type) {
        chunks.push(`type:${task.if_type}`);
      }
      if (task.if_state) {
        chunks.push(`state:${task.if_state}`);
      }
      if (task.if_created) {
        chunks.push(
          `created:<${moment()
            .subtract(...task.if_created.split(" "))
            .format(moment.defaultFormatUtc)}`
        );
      }
      if (task.if_updated) {
        chunks.push(
          `updated:<${moment()
            .subtract(...task.if_updated.split(" "))
            .format(moment.defaultFormatUtc)}`
        );
      }
      if (task.if_label) {
        const labels = Array.isArray(task.if_label) ? task.if_label : [task.if_label];
        for (let label of labels) {
          chunks.push(label === "no" ? `no:label` : `label:"${label}"`);
        }
      }
      if (task.if_no_label) {
        const labels = Array.isArray(task.if_no_label) ? task.if_no_label : [task.if_no_label];
        for (let label of labels) {
          chunks.push(label === "no" ? `-no:label` : `-label:"${label}"`);
        }
      }
      if (task.if_author) {
        chunks.push(`author:${task.if_author}`);
      }
      if (task.if_not_author) {
        chunks.push(`-author:${task.if_not_author}`);
      }
      if (task.if_assignee) {
        chunks.push(task.if_assignee == "no" ? `no:assignee` : `assignee:${task.if_assignee}`);
      }
      if (task.if_not_assigned) {
        chunks.push(`-assignee:${task.if_not_assigned}`);
      }
      if (typeof task.if_comments === "number") {
        chunks.push(`comments:<=${task.if_comments}`);
      }
      if (task.if_review) {
        chunks.push(`review:${task.if_review}`);
      }
      if (task.if_reviewed_by) {
        chunks.push(`reviewed-by:${task.if_reviewed_by}`);
      }
      if (task.if_linked) {
        chunks.push(`linked:${task.if_linked}`);
      }
      if (task.if_no_linked) {
        chunks.push(`-linked:${task.if_no_linked}`);
      }
      return chunks.join(" ");
    }
    return null;
  }

  async function buildTaskExecutor(task: TaskActionSet | null | undefined, context) {
    const { owner, repo } = context.repo();

    if (task) {
      return async (issue) => {
        if (task.remove_labels) {
          const labels = issue.labels.map((x) => x.name),
            targetLabels = Array.isArray(task.remove_labels) ? task.remove_labels : [task.remove_labels];
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
        if (task.add_labels) {
          await context.github.issues.addLabels({
            owner,
            repo,
            issue_number: issue.number,
            labels: Array.isArray(task.add_labels) ? task.add_labels : [task.add_labels],
          });
        }
        if (task.replace_labels) {
          await context.github.issues.replaceLabels({
            owner,
            repo,
            issue_number: issue.number,
            labels: Array.isArray(task.replace_labels) ? task.replace_labels : [task.replace_labels],
          });
        }
        if (task.comment) {
          const authors = [issue.user].filter((x) => x).map((x) => x.login),
            assignees = issue.assignees.map((x) => x.login),
            replacements = {
              "${AT_AUTHOR}": authors.map((x) => `@${x}`).join(" "),
              "${AT_ASSIGNEE}": assignees.map((x) => `@${x}`).join(" "),
              "${AUTHOR}": authors.join(" "),
              "${ASSIGNEE}": assignees.join(" "),
            };
          let commentBody = task.comment;
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
        if (task.set_state) {
          await context.github.issues.update({
            owner,
            repo,
            issue_number: issue.number,
            state: task.set_state,
          });
        }
        if (task.set_locked) {
          if (typeof task.set_locked === "boolean") {
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
              lock_reason: task.set_locked,
            });
          }
        }
        if (task.remove_assignees) {
          await context.github.issues.removeAssignees({
            owner,
            repo,
            issue_number: issue.number,
            assignees:
              task.remove_assignees === "all"
                ? issue.assignees.map((x) => x.login)
                : Array.isArray(task.remove_assignees)
                ? task.remove_assignees
                : [task.remove_assignees],
          });
        }
        if (task.add_assignees) {
          await context.github.issues.addAssignees({
            owner,
            repo,
            issue_number: issue.number,
            assignees: Array.isArray(task.add_assignees) ? task.add_assignees : [task.add_assignees],
          });
        }
      };
    }
    return null;
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
      const matchBefore = changes.body?.from.match(dupRegex),
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
    const config: AppConfig = (await context.config(configPath, defaultConfig)) as AppConfig;
    if ("label" in (config.duplicated_issues as DuplicatedIssuesConfig)) {
      const { issue } = context.payload,
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
