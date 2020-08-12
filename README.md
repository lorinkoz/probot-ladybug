# Probot Ladybug

> A GitHub App built with [Probot](https://github.com/probot/probot) to triages issues

Ladybug has these superpowers:

- When you have peer labels (e.g. `Status: Reproducing`, `Status: Confirmed`) she removes the other peer labels when one of them is assigned.
- If you mark an issue as duplicate of another, she will remember this and will chain close and chain reopen the duplicated issues when the reference issue is closed or reopened.
- You can configure rules for interacting with your issues. This is actually the superpower she's most proud of.
- You can configure rules for marking your issues via comment command.

Ladybug responds to a configuration file located in `.github/ladybug.yml`.

You can turn off the management of peer labels via:

```yml
peer_labels: false
```

You can also control the management of duplicated issue via:

```yml
duplicated_issues: false
```

The default value for this setting is:

```yml
duplicated_issues:
  # Label that will be used to mark / control duplicated issues (mandatory)
  label: "Status: Duplicated"
  # Whether to close duplicated issues in chain
  chain_close: true
  # Whether to reopen duplicated issues in chain
  chain_reopen: true
```

Additionaly, the rules for interacting with your issues can be configured through a set of conditions and actions.
Better to learn from an example:

```yml
scheduled_tasks:
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

| Condition         | Possible values                                            |
| ----------------- | ---------------------------------------------------------- |
| `if_type`         | `issue` or `pr`                                            |
| `if_state`        | `open` or `closed`                                         |
| `if_created`      | e.g `"3 days"`, `"2 hours"`, `"1 month"`                   |
| `if_updated`      | e.g `"3 days"`, `"2 hours"`, `"1 month"`                   |
| `if_label`        | label or array of labels or `no`                           |
| `if_no_label`     | label or array of labels or `no` (to exclude)              |
| `if_author`       | any username                                               |
| `if_not_author`   | any username (to exclude)                                  |
| `if_assignee`     | any username or `no`                                       |
| `if_not_assigned` | any username (to exclude)                                  |
| `if_comments`     | number of comments (less or equal)                         |
| `if_review`       | one of `none`, `required`, `approved`, `changes_requested` |
| `if_reviewed_by`  | any username                                               |
| `if_linked`       | `issue` or `pr`                                            |
| `if_no_linked`    | `issue` or `pr`                                            |

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
| `remove_assignees` | username or array of usernames or `all`         |

The placeholder for your comments are:

| Placeholder      | Values                                                  |
| ---------------- | ------------------------------------------------------- |
| `${AUTHOR}`      | Author of the issue, NOT including the leading `@`      |
| `${ASSIGNEE}`    | Assignee(s) of the issue, NOT including the leading `@` |
| `${AT_AUTHOR}`   | Author of the issue, including the leading `@`          |
| `${AT_ASSIGNEE}` | Assignee(s) of the issue, including the leading `@`     |

Finally, the reasons to lock an issue are:
`off-topic`, `too heated`, `resolved`, `spam`

There is another setting for marking your issues via comment commands. See the next section for a full explanation.

### Commands

#### `/checktask`

You can comment on any issue / PR with the command `/checktask`. It accepts space separated codenames of tasks to check.
Without parameters, all tasks will be checked.
Ladybug will reply with the query she ran for every task, and whether or not she found the current issue / PR.

#### `/trytask`

You can comment on any issue / PR with the command `/trytask`. It accepts one codename of a tasks to try.
Ladybug will execute the task that was passed in the current issue.

#### `/mark`

You can comment on any issue / PR with the command `/mark`. It accepts space separated codenames for rules of marking.
This command requires at least one valid codename. Marking rules are defined via configuration, like this:

```yml
mark_actions:
  wontfix: # codename of the rule
    replace_labels: "Status: Wontfix"
    set_state: closed
  regression:
    replace_labels: "Status: Confirmed"
    set_state: open
    comment: "Reopening this issue as a regression"
```

The same actions for scheduled tasks are available here.

In this example, if you comment `/mark wontfix` on any issue or PR, Ladybug will replace all labels with "Status: Wontfix" and will close the issue.

### Final word of advice from Ladybug

The scheduled tasks are run every 15 minutes. Make sure you actions change the status of your issues in a way that the
same task won't kick in again in 15 minutes, otherwise, you will create an infinite loop.

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
