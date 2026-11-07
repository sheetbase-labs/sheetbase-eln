# Run quality control API

A **quality control series** tracks one value across runs: the Z′ or control
means of a plate assay, or any value an instrument, pipeline or script sends
in. Each new point is judged against the series' limits (mean and SD) and its
**Westgard rules**, and a breach raises an event and a bell notification.

Charts (Levey-Jennings with ±1, 2 and 3 SD bands) are on the **Quality** tab of
a plate assay and in the **Quality control** section of an instrument page.

## Rules

| Rule   | Breach when                                                                      |
| ------ | -------------------------------------------------------------------------------- |
| `1-3s` | One point is beyond ±3 SD.                                                       |
| `2-2s` | Two points in a row are beyond 2 SD on the same side.                            |
| `R-4s` | Two points in a row are more than 4 SD apart (opposite sides, each beyond 2 SD). |
| `4-1s` | Four points in a row are beyond 1 SD on the same side.                           |
| `10x`  | Ten points in a row are on the same side of the mean.                            |

Pick the rules per series (default: all five). Without limits a series only
collects points; set them with `set_qc_baseline`, either as a `p_mean` and
`p_sd`, or as `p_first_n` to take them from the first N points. Setting limits
judges every point again.

## Tables

All on the lab read allowlist (`lab:read`):

- `qc_series`: the tracked values, with `mean`, `sd`, `rules`, `enabled` and
  `state` (`in_control` or `out_of_control`).
- `qc_points`: each value with its `z` (distance from the mean in SD), the
  `violations` it caused, whether it is `excluded` from the limits, and who
  acknowledged it.

```bash
# Series that are out of control right now
curl -H "Authorization: Bearer $TOKEN" \
  "https://app.example/api/db/qc_series?state=eq.out_of_control&select=id,name,mean,sd,state_changed_at"

# Open breaches of a series
curl -H "Authorization: Bearer $TOKEN" \
  "https://app.example/api/db/qc_points?series_id=eq.<id>&violations=neq.{}&acknowledged_at=is.null&select=id,value,at,violations"
```

## Actions (`lab:write`)

| Action                 | Use it to                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `create_qc_series`     | Start a `manual` series, or a `plate_metric` series for an assay design.                |
| `track_plate_assay_qc` | Track every plate quality metric of an assay design, backfilled from its analysed runs. |
| `update_qc_series`     | Rename, change rules or unit, pause or resume.                                          |
| `delete_qc_series`     | Stop tracking and delete the points.                                                    |
| `set_qc_baseline`      | Set the limits.                                                                         |
| `record_qc_point`      | Add a value; returns the point with its `z` and `violations`.                           |
| `acknowledge_qc_point` | Note what was done about a breach, optionally leaving it out of the limits.             |

`record_qc_point` and `acknowledge_qc_point` are also pipeline actions, and the assistant can set limits and acknowledge breaches
from a card the person confirms.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://app.example/api/db/rpc/record_qc_point \
  -d '{"p_series_id":"<id>","p_value":96.4,"p_label":"Run 31"}'
```

Plate series are fed automatically: every time a plate run of the assay design
is analysed, its Z′, signal to background and control means are added.

## Events

| Event                | Sent when                                                                             |
| -------------------- | ------------------------------------------------------------------------------------- |
| `qc.violation`       | A new point breaks a rule. Payload has the series, point, value, `z` and the `rules`. |
| `qc.back_in_control` | A series that was out of control gets a point that breaks no rule.                    |

Both can start a pipeline, for example to hold the next run or message a
channel. See [event-catalogue.md](event-catalogue.md). The person who tracks
the series also gets a bell notification, which links to the series.

## Access

Anyone in the workspace who can see the instrument or assay can read a series.
Writing needs a role that can write in the workspace. Service credentials can
read but not write.
