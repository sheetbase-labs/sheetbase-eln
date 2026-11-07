"""Proposes the next batch of experimental conditions with BayBE.

Runs inside the isolated Python runtime (`transform(inputs, parameters)`), which
has the pinned `baybe` package and no network. The app sends the campaign's
factors and objectives and every result so far, and reads one row back: the
recommended trials and a short account of how they were chosen. Nothing here
writes to Sheetbase.

parameters:
  factors       [{key, kind: continuous|discrete|categorical, min, max, values}]
  objectives    [{key, direction: maximise|minimise|target, target, weight}]
  observations  [{factors: {key: value}, values: {objective: value}}]
  batch_size    how many trials to recommend
  seed          for repeatable proposals

Several objectives become one score: each is turned into "higher is better"
(minimise flips the sign, a target becomes the distance from it), put on a common
scale, and added up with the objective's weight. BayBE then optimises that score.
"""
import math

SCORE = "score"
MAX_OBSERVATIONS = 2000


def _directed(objective, value):
    direction = objective.get("direction")
    if direction == "minimise":
        return -value
    if direction == "target":
        return -abs(value - float(objective["target"]))
    return value


def _scores(objectives, observations):
    """One score per observation: weighted, standardised, higher is better."""
    columns = []
    for objective in objectives:
        raw = [_directed(objective, float(o["values"][objective["key"]])) for o in observations]
        mean = sum(raw) / len(raw)
        spread = math.sqrt(sum((x - mean) ** 2 for x in raw) / len(raw))
        weight = float(objective.get("weight") or 1.0)
        columns.append([weight * ((x - mean) / spread if spread > 0 else 0.0) for x in raw])
    total_weight = sum(float(o.get("weight") or 1.0) for o in objectives)
    return [sum(column[i] for column in columns) / total_weight for i in range(len(observations))]


def _searchspace(factors):
    from baybe.parameters import (
        CategoricalParameter,
        NumericalContinuousParameter,
        NumericalDiscreteParameter,
    )
    from baybe.searchspace import SearchSpace

    parameters = []
    for factor in factors:
        kind = factor["kind"]
        if kind == "continuous":
            parameters.append(
                NumericalContinuousParameter(
                    name=factor["key"], bounds=(float(factor["min"]), float(factor["max"]))
                )
            )
        elif kind == "discrete":
            parameters.append(
                NumericalDiscreteParameter(
                    name=factor["key"], values=sorted({float(v) for v in factor["values"]})
                )
            )
        else:
            parameters.append(
                CategoricalParameter(name=factor["key"], values=[str(v) for v in factor["values"]])
            )
    return SearchSpace.from_product(parameters)


def transform(inputs, parameters):
    import baybe
    import pandas as pd
    from baybe import Campaign
    from baybe.objectives import SingleTargetObjective
    from baybe.targets import NumericalTarget
    from baybe.utils.random import set_random_seed

    factors = parameters["factors"]
    objectives = parameters["objectives"]
    observations = list(parameters.get("observations") or [])[-MAX_OBSERVATIONS:]
    batch_size = int(parameters["batch_size"])
    set_random_seed(int(parameters.get("seed") or 1))

    campaign = Campaign(
        searchspace=_searchspace(factors),
        objective=SingleTargetObjective(target=NumericalTarget(name=SCORE)),
    )
    if observations:
        frame = pd.DataFrame(
            [
                {
                    f["key"]: (str(o["factors"][f["key"]]) if f["kind"] == "categorical" else float(o["factors"][f["key"]]))
                    for f in factors
                }
                for o in observations
            ]
        )
        frame[SCORE] = _scores(objectives, observations)
        campaign.add_measurements(frame)

    recommendation = campaign.recommend(batch_size=batch_size)
    trials = []
    for _, row in recommendation.iterrows():
        trial = {}
        for factor in factors:
            value = row[factor["key"]]
            trial[factor["key"]] = str(value) if factor["kind"] == "categorical" else float(value)
        trials.append(trial)
    return [
        {
            "trials": trials,
            "engine": "baybe",
            "engine_version": str(baybe.__version__),
            "observations": len(observations),
            "strategy": "recommender" if observations else "initial design",
        }
    ]
