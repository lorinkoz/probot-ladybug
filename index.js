const createScheduler = require("probot-scheduler");
const moment = require("moment");

const configPath = "entomologist.yml",
  checkInterval = 5 * 60 * 1000,
  defaultConfig = {
    labels: {
      unconfirmed: "Status: Requires confirmation",
      confirmed: "Status: Confirmed",
      duplicated: "Status: Duplicated",
    },
    timeouts: {
      markUnconfirmed: 5, // minutes
    },
  };

async function configFromContext(context) {
  return await context.config(configPath, { ...defaultConfig });
}

module.exports = (app) => {
  app.log("Entomologist on duty!");
  createScheduler(app, {
    interval: checkInterval,
  });

  // Periodic housekeeping
  app.on("schedule.repository", async (context) => {
    const config = configFromContext(context);
    const { owner, repo } = context.repo();
    const result = await context.github.search.issues({
      q: `no:label" repo:${owner}/${repo}`,
    });

    await Promise.all(
      result.data.items.map(async (issue) => {
        // Marking unconfirmed
        if (
          moment(issue.created_at).add(config.timeouts.markUnconfirmed) <
          moment()
        ) {
          app.log(`Marking issue #${issue.number} as unconfirmed.`);
          context.github.issues.addLabels(
            issue({
              labels: [config.labels.unconfirmed],
            })
          );
        }
      })
    );
  });

  // Removing stale labels
  app.on("issues.labeled", async (context) => {
    const config = configFromContext(context);
    if (context.issue.label == config.labels.confirmed) {
      app.log(
        `Removing "${config.labels.unconfirmed}" from labels on issue #${context.issue.number}.`
      );
      context.github.issues.removeLabels(
        context.issue({
          labels: [config.labels.unconfirmed],
        })
      );
    } else if (context.issue.label == config.labels.unconfirmed) {
      app.log(
        `Removing "${config.labels.confirmed}" from labels on issue #${context.issue.number}.`
      );
      context.github.issues.removeLabels(
        context.issue({
          labels: [config.labels.confirmed],
        })
      );
    }
  });
};
