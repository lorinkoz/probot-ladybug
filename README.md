# Probot Ladybug

> A GitHub App built with [Probot](https://github.com/probot/probot) that Probot App to triage bug reports

Configuration is expected in `.github/ladybug.yml`. This is the default configuration:

```yml
labels: # Labels to track status of issues
  confirmed: "Status: Confirmed"
  duplicated: "Status: Duplicated"
  unconfirmed: "Status: Needs reproducing"
timeouts:
  unlabeled: 1 # 1 hour to label unlabeled issues as unconfirmed
  unassigned: 10 # 10 hours to comment on unassigned issues
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
