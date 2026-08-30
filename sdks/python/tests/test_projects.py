"""Tests for the Projects resource."""
import httpx
import pytest

from sheetbase import SheetbaseClient
from sheetbase.types import Project
from sheetbase.errors import NotFoundError

from tests.conftest import BASE_URL, CREDENTIAL


class TestProjectsResource:
    def test_list_projects(self, mock_transport, project_row):
        mock_transport.get("/api/db/projects").respond(200, json=[project_row])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            projects = client.projects.list()
        assert len(projects) == 1
        assert isinstance(projects[0], Project)
        assert projects[0].key == "lenti-purification"
        assert projects[0].title == "Lentivector Purification"
        assert projects[0].status == "active"

    def test_get_project_by_id(self, mock_transport, project_row):
        mock_transport.get("/api/db/projects").respond(200, json=[project_row])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            project = client.projects.get(project_row["id"])
        assert str(project.id) == project_row["id"]

    def test_get_project_not_found(self, mock_transport):
        mock_transport.get("/api/db/projects").respond(200, json=[])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            with pytest.raises(NotFoundError):
                client.projects.get("nonexistent")

    def test_get_project_by_key(self, mock_transport, project_row):
        mock_transport.get("/api/db/projects").respond(200, json=[project_row])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            project = client.projects.get_by_key("lenti-purification")
        assert project.key == "lenti-purification"

    def test_create_project(self, mock_transport, project_row):
        mock_transport.post("/api/db/rpc/create_project").respond(
            200, json=[project_row]
        )
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:write"]) as client:
            project = client.projects.create("Lentivector Purification")
        assert isinstance(project, Project)
        assert project.title == "Lentivector Purification"

    def test_update_project(self, mock_transport, project_row):
        updated = {**project_row, "title": "Updated Title"}
        mock_transport.patch("/api/db/projects").respond(200, json=[updated])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:write"]) as client:
            result = client.projects.update(project_row["id"], title="Updated Title")
        assert result[0]["title"] == "Updated Title"

    def test_iter_projects(self, mock_transport, project_row):
        # First page returns 2 rows (full page), second returns 0 (end).
        route = mock_transport.get("/api/db/projects")
        route.mock(side_effect=[
            httpx.Response(200, json=[project_row, {**project_row, "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "key": "second"}]),
            httpx.Response(200, json=[]),
        ])
        with SheetbaseClient(BASE_URL, CREDENTIAL, ["projects:read"]) as client:
            projects = list(client.projects.iter(page_size=2))
        assert len(projects) == 2
        assert all(isinstance(p, Project) for p in projects)
