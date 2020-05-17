const createScheduler = require("probot-scheduler");
const metadata = require("probot-metadata");
const moment = require("moment");

const configPath = "ladybug.yml",
	defaultConfig = {
		labels: {
			unconfirmed: "Status: Needs reproducing",
			confirmed: "Status: Confirmed",
			duplicated: "Status: Duplicated",
		},
		timeouts: {
			unlabeled: 5, // minutes
			unassigned: 10 * 60, // minutes (10 hours)
		},
	};

module.exports = (app) => {
	app.log("Ladybug on duty!");
	createScheduler(app, {
		interval: 5 * 60 * 1000, // 5 minutes
	});

	app.on("schedule.repository", periodicCheck);
	app.on("issues.labeled", removePeerLabels);
	app.on("issue_comment.created", checkDuplicateIssue);
	app.on("issue_comment.edited", checkDuplicateIssue);
	app.on("issue_comment.deleted", checkDuplicateIssue);
	app.on("issue.closed", checkChainClosing);
	app.on("issue.reopened", checkChainReopening);

	// Tasks of periodic housekeeping
	async function periodicCheck(context) {
		const config = await context.config(configPath, defaultConfig);
		const { owner, repo } = context.repo();
		const searchResults = await context.github.search.issuesAndPullRequests({
			q: `no:label" repo:${owner}/${repo}`,
		});

		async function declareUnconfirmed(issue, context) {
			const { owner, repo, number } = issue;
			app.log(`Declaring issue #${issue.number} as unconfirmed.`);
			context.github.issues.addLabels({
				owner,
				repo,
				number,
				labels: [config.labels.unconfirmed],
			});
		}

		async function declareFirstChime(issue, context) {
			const { owner, repo, number } = issue;
			app.log(`Chiming on #${issue.number} for the first time.`);
			context.github.issues.createComment({
				owner,
				repo,
				number,
				body: "Buzzing in to put this report in your radar.",
			});
		}

		await Promise.all(
			searchResults.data.items.map(async (issue) => {
				issue = context.repo(issue);
				const unlabeled =
						issue.state == "open" &&
						moment(issue.created_at).add(config.timeouts.unlabeled, "minutes") < moment() &&
						!issue.labels.length,
					unassigned =
						issue.state == "open" &&
						moment(issue.created_at).add(config.timeouts.unassigned, "minutes") < moment() &&
						!issue.assignee;

				if (unlabeled) {
					declareUnconfirmed(issue, context);
				}
				if (unassigned) {
					declareFirstChime(issue, context);
				}
			})
		);
	}

	// Removes peer labels
	async function removePeerLabels(context) {
		const peerRegex = /^(.*):/,
			{ label, issue } = context.payload,
			match = label.name.match(peerRegex);

		if (match) {
			const labels = issue.labels.filter((x) => !x.name.match(peerRegex));
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
			context.github.issues.removeLabel(
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
			if (!matchBefore && matchAfter) {
				markDuplicate(matchAfter[1]);
			} else if (matchBefore && !matchAfter) {
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
	async function checkChainClosing(context) {}

	// Checks reopened issue for chain reopening
	async function checkChainReopening(context) {}
};
