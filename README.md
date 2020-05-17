# Probot Ladybug

> A GitHub App built with [Probot](https://github.com/probot/probot) to triage bug reports

This app is capable of:

- Label your unlabelled issues after some time of creation.
- Comment on your unassigned issues after some time of creation.
- Follow up on your open issues if they haven't been updated for some time.
- Track duplicated issues and close them when the referred issue is closed. Reopen them if the referred issue is reopened.
- Remove peer labels when a label is assigned (peer labels are those that begin with a common prefix like `Something:`, the colon is important)

Configuration is expected in `.github/ladybug.yml`. This is the default configuration:

```yml
labels: # Labels to track status of issues
  confirmed: "Status: Confirmed"
  duplicated: "Status: Duplicated"
  unconfirmed: "Status: Needs reproducing"
timeouts:
  unchimed: 10 # 10 hours to comment on issues with no comments and no assignees
  unfollowed: 48 # 48 hours to follow up on issues without modifications
  unlabeled: 1 # 1 hour to label unlabeled issues as unconfirmed
```

## Setup

```sh
# Install dependencies
yarn install

# Run the bot
yarn start
```

## Contributing

If you have suggestions for how probot-ladybug could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2020 Lorenzo Peña <lorinkoz@gmail.com>
