# Probot Ladybug

> A GitHub App built with [Probot](https://github.com/probot/probot) to triages issues

Ladybug has these superpowers:

- When you have peer labels (e.g. `Status: Reproducing`, `Status: Confirmed`) she removes the other peer labels when one of them is assigned.
- If you mark an issue as duplicate of another, and don't close it, she will remember this and will chain close and chain reopen the duplicated issues when the reference issue is closed or reopened.
- You can configure rules for interacting with your issues. This is actually the superpower she's most proud of.

Ladybug responds to a configuration file located in `.github/ladybug.yml`.

You can turn on/off the management of peer labels via:

```yml
peer_labels: false # default is true
```

You can also control the management of duplicated issue via:

```yml
duplicated_issues: false
```

The default value for this setting is:

```yml
duplicated_issues:
  label: "Status: Duplicated" # Label that will be used to mark / control duplicated issues
  chain_close: true # Whether to close duplicated issues in chain
  chain_reopen: true # Whether to reopen duplicated issues in chain
```

Finally, the rules for interacting with your issues can be configured through a set of conditions and actions.
Better to learn from an example:

```yml
scheduled_checks:
  label_unlabelled: # codename of the rule
    if_type: issue
    if_state: open
    if_created: "1 hour"
    if_label: no
    add_labels: "Status: Pending"
    comment: "Since this has been one hour without labels, I took the liberty to mark as pending"
  assign_unassigned:
    if_type: issue
    if_state: open
    if_created: "8 hours"
    if_assignee: no
    add_assignees: john
```

These are the available conditions for your rules:

| Condition     | Possible values                                  |
| ------------- | ------------------------------------------------ |
| `if_type`     | `issue` or `pr`                                  |
| `if_state`    | `open` or `closed`                               |
| `if_created`  | any valid parameter for `moment().subtract(...)` |
| `if_updated`  | any valid parameter for `moment().subtract(...)` |
| `if_label`    | any label or `no`                                |
| `if_assignee` | any username or `no`                             |
| `if_comments` | number of comments (less or equal)               |

And the available actions:

| Action             | Possible values                                 |
| ------------------ | ----------------------------------------------- |
| `add_labels`       | label or array of labels                        |
| `remove_labels`    | label or array of labels                        |
| `replace_labels`   | label or array of labels                        |
| `comment`          | comment body (see placeholders below)           |
| `set_state`        | `open` or `closed`                              |
| `set_locked`       | `false` or one of the valid reasons (see below) |
| `add_assignees`    | username or array of usernames                  |
| `remove_assignees` | username or array of usernames                  |

The placeholder for your comments are:

| Placeholder   | Values                                               |
| ------------- | ---------------------------------------------------- |
| `${AUTHOR}`   | Author of the issue, NOT including the leading `@`   |
| `${ASSIGNEE}` | Assignee of the issue, NOT including the leading `@` |

The leading `@` is NOT included in case you don't want to tag the user directly.

Finally, the reasons to lock an issue are:
`off-topic`, `too heated`, `resolved`, `spam`

### Final word of advice from Ladybug

The scheduled tasks are run every 5 minutes. Make sure you actions change the status of your issues in a way that the
same action won't kick in again in 5 minutes, otherwise, you will create an infinite loop.

That's all! Enjoy!

## Setup

```sh
# Install dependencies
yarn install

# Run with hot reload
yarn run build:watch

# Compile and run
yarn run build
yarn run start
```

## Contributing

If you have suggestions for how probot-ladybug could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2020 Lorenzo Peña <lorinkoz@gmail.com>
