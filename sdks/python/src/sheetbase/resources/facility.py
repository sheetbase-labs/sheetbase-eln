"""Facility resource — suppliers, order prices, instrument rates, spend and usage reports and scheduled reports.

Reads need the ``facility:read`` scope and writes ``facility:write``. Money is
per currency: totals are never converted between currencies.
"""
from __future__ import annotations

from typing import Any, Optional


class FacilityResource:
    def __init__(self, transport: Any) -> None:
        self._transport = transport

    def create_supplier_model(
        self,
        *,
        key: str,
        name: str,
        prefix: str,
        description: str,
        fields: Any,
    ) -> Any:
        body: dict[str, Any] = {
            "p_key": key,
            "p_name": name,
            "p_prefix": prefix,
            "p_description": description,
            "p_fields": fields,
        }
        return self._transport.post("/api/db/rpc/create_supplier_model", json_body=body)

    def set_model_supplier_list(
        self,
        *,
        model_key: str,
        enabled: bool,
    ) -> Any:
        body: dict[str, Any] = {
            "p_model_key": model_key,
            "p_enabled": enabled,
        }
        return self._transport.post("/api/db/rpc/set_model_supplier_list", json_body=body)

    def mark_reagent_ordered(
        self,
        *,
        order_id: str,
        order_reference: Optional[str] = None,
        expected_on: Optional[str] = None,
        supplier: Optional[str] = None,
        supplier_record_id: Optional[str] = None,
        total_price: Optional[float] = None,
        currency: Optional[str] = None,
    ) -> Any:
        body: dict[str, Any] = {
            "p_order_id": order_id,
        }
        if order_reference is not None:
            body["p_order_reference"] = order_reference
        if expected_on is not None:
            body["p_expected_on"] = expected_on
        if supplier is not None:
            body["p_supplier"] = supplier
        if supplier_record_id is not None:
            body["p_supplier_record_id"] = supplier_record_id
        if total_price is not None:
            body["p_total_price"] = total_price
        if currency is not None:
            body["p_currency"] = currency
        return self._transport.post("/api/db/rpc/mark_reagent_ordered", json_body=body)

    def set_reagent_order_price(
        self,
        *,
        order_id: str,
        total_price: float,
        currency: Optional[str] = None,
    ) -> Any:
        body: dict[str, Any] = {
            "p_order_id": order_id,
            "p_total_price": total_price,
        }
        if currency is not None:
            body["p_currency"] = currency
        return self._transport.post("/api/db/rpc/set_reagent_order_price", json_body=body)

    def set_instrument_rate(
        self,
        *,
        instrument_id: str,
        rate_per_hour: float,
        currency: Optional[str] = None,
    ) -> Any:
        body: dict[str, Any] = {
            "p_instrument_id": instrument_id,
            "p_rate_per_hour": rate_per_hour,
        }
        if currency is not None:
            body["p_currency"] = currency
        return self._transport.post("/api/db/rpc/set_instrument_rate", json_body=body)

    def report_spend_lines(
        self,
        *,
        workspace_id: str,
        from_: str,
        to: str,
    ) -> Any:
        body: dict[str, Any] = {
            "p_workspace_id": workspace_id,
            "p_from": from_,
            "p_to": to,
        }
        return self._transport.post("/api/db/rpc/report_spend_lines", json_body=body)

    def report_usage_lines(
        self,
        *,
        workspace_id: str,
        from_: str,
        to: str,
    ) -> Any:
        body: dict[str, Any] = {
            "p_workspace_id": workspace_id,
            "p_from": from_,
            "p_to": to,
        }
        return self._transport.post("/api/db/rpc/report_usage_lines", json_body=body)

    def report_project_status(
        self,
        *,
        workspace_id: str,
        from_: str,
        to: str,
        project_id: Optional[str] = None,
    ) -> Any:
        body: dict[str, Any] = {
            "p_workspace_id": workspace_id,
            "p_from": from_,
            "p_to": to,
        }
        if project_id is not None:
            body["p_project_id"] = project_id
        return self._transport.post("/api/db/rpc/report_project_status", json_body=body)

    def save_scheduled_report(
        self,
        *,
        name: str,
        kind: str,
        period: str,
        frequency: str,
        recipient_user_ids: Any,
        id: Optional[str] = None,
        project_id: Optional[str] = None,
        open_hours: Optional[Any] = None,
        weekday: Optional[float] = None,
        month_day: Optional[float] = None,
        send_hour: Optional[float] = None,
        time_zone: Optional[str] = None,
        active: Optional[bool] = None,
    ) -> Any:
        body: dict[str, Any] = {
            "p_name": name,
            "p_kind": kind,
            "p_period": period,
            "p_frequency": frequency,
            "p_recipient_user_ids": recipient_user_ids,
        }
        if id is not None:
            body["p_id"] = id
        if project_id is not None:
            body["p_project_id"] = project_id
        if open_hours is not None:
            body["p_open_hours"] = open_hours
        if weekday is not None:
            body["p_weekday"] = weekday
        if month_day is not None:
            body["p_month_day"] = month_day
        if send_hour is not None:
            body["p_send_hour"] = send_hour
        if time_zone is not None:
            body["p_time_zone"] = time_zone
        if active is not None:
            body["p_active"] = active
        return self._transport.post("/api/db/rpc/save_scheduled_report", json_body=body)

    def set_scheduled_report_active(
        self,
        *,
        id: str,
        active: bool,
    ) -> Any:
        body: dict[str, Any] = {
            "p_id": id,
            "p_active": active,
        }
        return self._transport.post("/api/db/rpc/set_scheduled_report_active", json_body=body)

    def send_scheduled_report_now(
        self,
        *,
        id: str,
    ) -> Any:
        body: dict[str, Any] = {
            "p_id": id,
        }
        return self._transport.post("/api/db/rpc/send_scheduled_report_now", json_body=body)

    def delete_scheduled_report(
        self,
        *,
        id: str,
    ) -> Any:
        body: dict[str, Any] = {
            "p_id": id,
        }
        return self._transport.post("/api/db/rpc/delete_scheduled_report", json_body=body)
