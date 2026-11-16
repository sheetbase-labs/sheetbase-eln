# Results analysis: dose-response curves, standard curves and group comparisons.
# `kind` is dose_response, standard_curve or compare_groups; the other settings
# name columns of the table that is read. Change them and run the cell again.
PARAMS = {}  # sheetbase:settings

# Everything below is the analysis. It imports nothing from Sheetbase, so a
# notebook code cell can run it on a dataset's rows and the Results analysis
# plugin can run the same file on rows sent over the API.
import base64
import io
import math

import matplotlib

matplotlib.use("Agg")
matplotlib.rcParams["svg.hashsalt"] = "sheetbase"
matplotlib.rcParams["svg.fonttype"] = "none"

import matplotlib.pyplot as plt
import numpy as np
from scipy import optimize, stats

COLOURS = ["#2f6fdd", "#d9582b", "#2a9d6f", "#8a5cd0", "#c9a227", "#d6457a"]
FIGURE_FIELD = "figure"


def _number(value):
    """A cell as a float, or None for blank, text and non-finite values."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _shown(settings, role, column):
    """What an axis or legend calls a column: its label if one was given, else its name."""
    labels = settings.get("labels") or {}
    return str(labels.get(role) or column)


def _round(value, digits=4):
    if value is None:
        return None
    value = float(value)
    if not math.isfinite(value):
        return None
    if value == 0:
        return 0.0
    magnitude = math.floor(math.log10(abs(value)))
    return round(value, max(digits - 1 - magnitude, 0))


def _column(settings, name, required=True):
    value = settings.get(name)
    if value in (None, ""):
        if required:
            raise ValueError(f"Say which column is the {name.replace('_', ' ')}.")
        return None
    return str(value)


def _check_columns(rows, *names):
    if not rows:
        raise ValueError("There are no rows to analyse.")
    present = set()
    for row in rows:
        present.update(row.keys())
    for name in names:
        if name and name not in present:
            raise ValueError(
                f"There is no column called {name}. The columns are: {', '.join(sorted(present))}."
            )


def _figure(fig):
    buffer = io.BytesIO()
    fig.savefig(buffer, format="svg", metadata={"Date": None}, bbox_inches="tight")
    plt.close(fig)
    return "data:image/svg+xml;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _style(ax, xlabel, ylabel, title):
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.set_title(title, fontsize=11)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(True, color="#e3e3e3", linewidth=0.6)
    ax.set_axisbelow(True)


# -- curves ------------------------------------------------------------------


def four_pl(log_x, bottom, top, log_c, hill):
    """The four-parameter logistic in log10 dose: bottom, top, log10 EC50 and slope."""
    return bottom + (top - bottom) / (1.0 + 10.0 ** ((log_c - log_x) * hill))


def _r_squared(y, fitted):
    residual = float(np.sum((y - fitted) ** 2))
    total = float(np.sum((y - np.mean(y)) ** 2))
    return None if total == 0 else 1.0 - residual / total


def fit_four_pl(x, y):
    """Fit a 4PL to doses (all above zero) and responses. Returns a dict or raises ValueError."""
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    log_x = np.log10(x)
    if len(set(np.round(log_x, 9))) < 4:
        raise ValueError("needs at least four different doses above zero")
    if len(x) < 5:
        raise ValueError("needs at least five points")
    span = float(y.max() - y.min())
    if span == 0:
        raise ValueError("the response does not change with dose")
    rising = float(np.corrcoef(log_x, y)[0, 1]) >= 0 if np.std(y) > 0 else True
    best = None
    for hill0 in (1.0, 2.0, 0.5):
        start = [
            float(y.min() if rising else y.max()),
            float(y.max() if rising else y.min()),
            float(np.median(log_x)),
            hill0 if rising else -hill0,
        ]
        low = float(y.min() - span)
        high = float(y.max() + span)
        bounds = (
            [low, low, float(log_x.min() - 2), -20.0],
            [high, high, float(log_x.max() + 2), 20.0],
        )
        try:
            params, covariance = optimize.curve_fit(
                four_pl, log_x, y, p0=start, bounds=bounds, maxfev=20000
            )
        except (RuntimeError, ValueError):
            continue
        sse = float(np.sum((y - four_pl(log_x, *params)) ** 2))
        if best is None or sse < best[0]:
            best = (sse, params, covariance)
    if best is None:
        raise ValueError("the curve did not settle on a fit")
    _, params, covariance = best
    bottom, top, log_c, hill = (float(p) for p in params)
    if bottom > top:
        # The same curve, named the usual way: bottom is the lower plateau and a
        # falling curve has a negative slope.
        bottom, top, hill = top, bottom, -hill
    errors = np.sqrt(np.diag(covariance)) if np.all(np.isfinite(covariance)) else [np.nan] * 4
    log_error = float(errors[2])
    ec50 = 10.0 ** log_c
    low_ci = 10.0 ** (log_c - 1.96 * log_error) if math.isfinite(log_error) else None
    high_ci = 10.0 ** (log_c + 1.96 * log_error) if math.isfinite(log_error) else None
    return {
        "bottom": bottom,
        "top": top,
        "ec50": ec50,
        "ec50_low": low_ci,
        "ec50_high": high_ci,
        "hill": hill,
        "r2": _r_squared(y, four_pl(log_x, *params)),
        "n": int(len(x)),
    }


def _groups(rows, group):
    order = []
    members = {}
    for row in rows:
        key = "All" if group is None else str(row.get(group) if row.get(group) is not None else "(blank)")
        if key not in members:
            members[key] = []
            order.append(key)
        members[key].append(row)
    return order, members


def dose_response(rows, settings):
    x_name = _column(settings, "x")
    y_name = _column(settings, "y")
    group_name = _column(settings, "group", required=False)
    _check_columns(rows, x_name, y_name, group_name)
    unit = settings.get("unit") or ""
    x_label = _shown(settings, "x", x_name)
    y_label = _shown(settings, "y", y_name)
    if unit and unit not in x_label:
        x_label = f"{x_label} ({unit})"
    order, members = _groups(rows, group_name)
    results, series = [], []
    for name in order:
        points = []
        for row in members[name]:
            dose, response = _number(row.get(x_name)), _number(row.get(y_name))
            if dose is not None and response is not None:
                points.append((dose, response))
        positive = [p for p in points if p[0] > 0]
        record = {"group": name, "points": len(points)}
        try:
            if not positive:
                raise ValueError("no doses above zero")
            fit = fit_four_pl([p[0] for p in positive], [p[1] for p in positive])
            record.update({"status": "fitted", **fit})
        except ValueError as error:
            fit = None
            record.update({"status": f"not fitted: {error}"})
        results.append(record)
        series.append((name, points, fit))
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    for index, (name, points, fit) in enumerate(series):
        colour = COLOURS[index % len(COLOURS)]
        positive = [p for p in points if p[0] > 0]
        if not positive:
            continue
        by_dose = {}
        for dose, response in positive:
            by_dose.setdefault(dose, []).append(response)
        doses = sorted(by_dose)
        means = [float(np.mean(by_dose[d])) for d in doses]
        ax.scatter(doses, means, color=colour, s=22, zorder=3, label=name if group_name else None)
        if fit:
            grid = np.logspace(math.log10(min(doses)), math.log10(max(doses)), 200)
            curve = four_pl(np.log10(grid), fit["bottom"], fit["top"], math.log10(fit["ec50"]), fit["hill"])
            ax.plot(grid, curve, color=colour, linewidth=1.6, zorder=2)
            ax.axvline(fit["ec50"], color=colour, linewidth=0.8, linestyle=":", alpha=0.7)
    ax.set_xscale("log")
    _style(ax, x_label, y_label, "Dose-response, four-parameter fit")
    if group_name and len(series) > 1:
        ax.legend(frameon=False, fontsize=8)
    out = []
    for record in results:
        fitted = record["status"] == "fitted"
        out.append(
            {
                "group": record["group"],
                "ec50": _round(record.get("ec50")) if fitted else None,
                "ec50_low": _round(record.get("ec50_low")) if fitted else None,
                "ec50_high": _round(record.get("ec50_high")) if fitted else None,
                "hill": _round(record.get("hill")) if fitted else None,
                "bottom": _round(record.get("bottom")) if fitted else None,
                "top": _round(record.get("top")) if fitted else None,
                "r2": _round(record.get("r2"), 3) if fitted else None,
                "points": record["points"],
                "status": record["status"],
                "kind": "result",
            }
        )
    out.append({"title": "Dose-response curves (four-parameter fit)", FIGURE_FIELD: _figure(fig), "kind": "figure"})
    return out


def _linear_fit(x, y):
    slope, intercept, r_value, _, _ = stats.linregress(x, y)
    return {"model": "linear", "slope": float(slope), "intercept": float(intercept), "r2": float(r_value**2)}


def standard_curve(rows, settings):
    x_name = _column(settings, "x")
    y_name = _column(settings, "y")
    label_name = _column(settings, "label", required=False)
    _check_columns(rows, x_name, y_name, label_name)
    model = str(settings.get("model") or "linear")
    if model not in ("linear", "4pl"):
        raise ValueError("The model must be linear or 4pl.")
    standards, unknowns = [], []
    for index, row in enumerate(rows):
        signal = _number(row.get(y_name))
        concentration = _number(row.get(x_name))
        if signal is None:
            continue
        if concentration is None:
            name = row.get(label_name) if label_name else None
            unknowns.append((str(name) if name not in (None, "") else f"Sample {index + 1}", signal))
        else:
            standards.append((concentration, signal))
    if len(standards) < 3:
        raise ValueError("A standard curve needs at least three standards with a known value.")
    xs = np.array([s[0] for s in standards])
    ys = np.array([s[1] for s in standards])
    if model == "linear":
        fit = _linear_fit(xs, ys)
        if fit["slope"] == 0:
            raise ValueError("The standards give a flat line, so nothing can be read from it.")

        def forward(c):
            return fit["slope"] * c + fit["intercept"]

        def inverse(signal):
            return (signal - fit["intercept"]) / fit["slope"]

        detail = {"slope": _round(fit["slope"]), "intercept": _round(fit["intercept"])}
    else:
        positive = xs > 0
        four = fit_four_pl(xs[positive], ys[positive])
        fit = {"model": "4pl", "r2": four["r2"]}

        def forward(c):
            return four_pl(np.log10(c), four["bottom"], four["top"], math.log10(four["ec50"]), four["hill"])

        def inverse(signal):
            bottom, top, hill = four["bottom"], four["top"], four["hill"]
            fraction = (signal - bottom) / (top - bottom)
            if not 0 < fraction < 1:
                return None
            return four["ec50"] * (fraction / (1 - fraction)) ** (1.0 / hill) if hill > 0 else four["ec50"] * ((1 - fraction) / fraction) ** (1.0 / -hill)

        detail = {"ec50": _round(four["ec50"]), "hill": _round(four["hill"])}
    low, high = float(xs.min()), float(xs.max())
    signal_low, signal_high = sorted((float(forward(low)), float(forward(high))))
    out = [
        {
            "name": "Standard curve",
            "concentration": None,
            "in_range": None,
            "signal": None,
            "model": fit["model"],
            "r2": _round(fit["r2"], 4),
            "standards": len(standards),
            "range": f"{_round(low)} to {_round(high)}",
            **detail,
            "kind": "curve",
        }
    ]
    values = []
    for name, signal in unknowns:
        concentration = inverse(signal)
        inside = concentration is not None and signal_low <= signal <= signal_high
        values.append((name, signal, concentration, inside))
        out.append(
            {
                "name": name,
                "concentration": _round(concentration) if concentration is not None else None,
                "in_range": "yes" if inside else "no: outside the standards",
                "signal": _round(signal),
                "kind": "sample",
            }
        )
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    ax.scatter(xs, ys, color=COLOURS[0], s=26, zorder=3, label="Standards")
    grid = np.linspace(low, high, 200) if model == "linear" else np.logspace(math.log10(max(low, high / 1e4)), math.log10(high), 200)
    ax.plot(grid, forward(grid), color=COLOURS[0], linewidth=1.6, zorder=2)
    shown = [(c, s) for _, s, c, inside in values if c is not None]
    if shown:
        ax.scatter([c for c, _ in shown], [s for _, s in shown], color=COLOURS[1], marker="D", s=24, zorder=4, label="Samples")
    if model == "4pl":
        ax.set_xscale("log")
    _style(ax, _shown(settings, "x", x_name), _shown(settings, "y", y_name), f"Standard curve ({fit['model']}, R² = {_round(fit['r2'], 4)})")
    ax.legend(frameon=False, fontsize=8)
    out.append({"title": "Standard curve", FIGURE_FIELD: _figure(fig), "kind": "figure"})
    return out


def compare_groups(rows, settings):
    group_name = _column(settings, "group")
    y_name = _column(settings, "y")
    _check_columns(rows, group_name, y_name)
    order, members = _groups(rows, group_name)
    values = {}
    for name in order:
        numbers = [n for n in (_number(r.get(y_name)) for r in members[name]) if n is not None]
        if numbers:
            values[name] = np.array(numbers)
    if len(values) < 2:
        raise ValueError("Comparing needs at least two groups with numbers in them.")
    out = []
    for name, numbers in values.items():
        count = len(numbers)
        sd = float(np.std(numbers, ddof=1)) if count > 1 else None
        out.append(
            {
                "name": name,
                "n": count,
                "mean": _round(np.mean(numbers)),
                "sd": _round(sd) if sd is not None else None,
                "sem": _round(sd / math.sqrt(count)) if sd is not None else None,
                "test": None,
                "difference": None,
                "statistic": None,
                "p_value": None,
                "effect_size": None,
                "kind": "group",
            }
        )
    names = list(values)
    usable = [values[n] for n in names if len(values[n]) >= 2]
    if len(names) == 2 and len(usable) == 2:
        first, second = values[names[0]], values[names[1]]
        result = stats.ttest_ind(first, second, equal_var=False)
        pooled = math.sqrt((np.var(first, ddof=1) + np.var(second, ddof=1)) / 2)
        out.append(
            {
                "name": f"{names[0]} vs {names[1]}",
                "test": "Welch t-test",
                "difference": _round(np.mean(first) - np.mean(second)),
                "statistic": _round(float(result.statistic)),
                "p_value": _round(float(result.pvalue), 3),
                "effect_size": _round((np.mean(first) - np.mean(second)) / pooled, 3) if pooled else None,
                "kind": "test",
            }
        )
    elif len(usable) >= 3:
        anova = stats.f_oneway(*usable)
        out.append(
            {
                "name": ", ".join(names),
                "test": "One-way ANOVA",
                "statistic": _round(float(anova.statistic)),
                "p_value": _round(float(anova.pvalue), 3),
                "kind": "test",
            }
        )
        tukey = stats.tukey_hsd(*[values[n] for n in names])
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                out.append(
                    {
                        "name": f"{names[i]} vs {names[j]}",
                        "test": "Tukey HSD",
                        "difference": _round(float(np.mean(values[names[i]]) - np.mean(values[names[j]]))),
                        "p_value": _round(float(tukey.pvalue[i][j]), 3),
                        "kind": "test",
                    }
                )
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    rng = np.random.default_rng(7)
    for index, name in enumerate(names):
        numbers = values[name]
        colour = COLOURS[index % len(COLOURS)]
        ax.scatter(index + rng.uniform(-0.12, 0.12, len(numbers)), numbers, color=colour, s=18, alpha=0.8, zorder=3)
        mean = float(np.mean(numbers))
        sem = float(np.std(numbers, ddof=1) / math.sqrt(len(numbers))) if len(numbers) > 1 else 0.0
        ax.hlines(mean, index - 0.28, index + 0.28, color="#222222", linewidth=1.6, zorder=4)
        ax.errorbar(index, mean, yerr=sem, color="#222222", capsize=4, linewidth=1.2, zorder=4)
    ax.set_xticks(range(len(names)))
    ax.set_xticklabels(names, rotation=0 if len(names) < 6 else 40)
    _style(ax, _shown(settings, "group", group_name), _shown(settings, "y", y_name), "Groups compared (mean and standard error)")
    out.append({"title": "Groups compared", FIGURE_FIELD: _figure(fig), "kind": "figure"})
    return out


KINDS = {
    "dose_response": dose_response,
    "standard_curve": standard_curve,
    "compare_groups": compare_groups,
}


def run(rows, settings):
    """The analysis named by `settings['kind']` on a list of row dicts."""
    kind = settings.get("kind")
    if kind not in KINDS:
        raise ValueError(f"The kind must be one of {', '.join(KINDS)}.")
    return KINDS[kind](list(rows), settings)


def transform(inputs, parameters):
    """What a notebook code cell calls: the first input is the data."""
    name = PARAMS.get("input") or next(iter(inputs))
    return run(inputs[name], PARAMS)
