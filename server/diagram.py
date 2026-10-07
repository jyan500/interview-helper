"""The system-design diagram canvas: its wire/storage shape and how the LLMs read it.

The SPA's canvas (React Flow) maps its own state onto `DiagramDoc`, our slim shape (no viewport,
selection or styling), and sends it with a turn. The server validates it here, stores the dump on the
open turn (`turns.diagram`), and hands the LLMs `serialize_diagram`'s text, never the JSON.

WHY TEXT, NOT AN IMAGE: the canvas is structured (typed components + labeled connections), so the
meaning is already explicit. No vision call is needed to recover it.

WHY OUR TEXT FORMAT, NOT THE RAW JSON (json.dumps would work; this works better):
- The id joins are done ahead of time. An edge in the JSON is `"source": "n3", "target": "n5"`, which
  the model must look up among the nodes for every connection. Cheap models slip on that as diagrams
  grow. The text says `"Feed svc" -> "Posts DB": reads`.
- Fewer tokens, every turn. Ids, x/y, `version`, empty fields and the repeated key names are dropped
  (the text is roughly 3-5x smaller), and the diagram is replayed in message_history on every later
  turn, so the saving adds up.
- The model never sees coordinates. Leaving them out is more reliable than telling the grader to
  ignore layout.
- Change detection comes for free. Dragging a node changes the JSON but not the text, so /api/answer
  compares texts to tell "the candidate rearranged" from "the candidate changed the design", and
  re-sends the diagram to the interviewer only for the latter.
- Code works out facts the model might miss: unconnected components, unnamed nodes ("(unnamed
  cache)"), and duplicate names ("#2").
- It's readable for us when we print a filled prompt while debugging.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

# The palette. Mirrored by DIAGRAM_NODE_KINDS in client/src/constants.ts: add a kind in BOTH places.
NodeKind = Literal[
    "client", "load_balancer", "api_gateway", "service", "worker", "database", "cache", "queue",
    "blob_storage", "cdn", "search", "external", "box", "circle", "text",
]

# Caps: generous for a 45-minute design, but they bound what one turn (and every later replay of
# message_history) can cost. Violations are a 422 from request validation.
MAX_NODES = 60
MAX_EDGES = 120
MAX_LABEL_CHARS = 80
MAX_NOTES_CHARS = 500


class DiagramNode(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    kind: NodeKind
    label: str = Field(default="", max_length=MAX_LABEL_CHARS)
    notes: str = Field(default="", max_length=MAX_NOTES_CHARS)
    x: float = 0
    y: float = 0


class DiagramEdge(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    source: str
    target: str
    label: str = Field(default="", max_length=MAX_LABEL_CHARS)
    bidirectional: bool = False


class DiagramDoc(BaseModel):
    version: Literal[1] = 1
    nodes: list[DiagramNode] = Field(default_factory=list, max_length=MAX_NODES)
    edges: list[DiagramEdge] = Field(default_factory=list, max_length=MAX_EDGES)

    @model_validator(mode="after")
    def _check_ids(self) -> DiagramDoc:
        node_ids = set()
        for node in self.nodes:
            if node.id in node_ids:
                raise ValueError(f"duplicate node id '{node.id}'")
            node_ids.add(node.id)
        edge_ids = set()
        for edge in self.edges:
            if edge.id in edge_ids:
                raise ValueError(f"duplicate edge id '{edge.id}'")
            edge_ids.add(edge.id)
            if edge.source not in node_ids or edge.target not in node_ids:
                raise ValueError(f"edge '{edge.id}' connects a node that isn't in the diagram")
        return self


def _kind_name(kind: str) -> str:
    return kind.replace("_", " ")


def _display_names(nodes: list[DiagramNode]) -> dict[str, str]:
    """node id -> how the text refers to it. A label is quoted; an unlabeled node is "(unnamed
    database)"; a repeated name gets " #2", " #3" so connections stay unambiguous."""
    names: dict[str, str] = {}
    seen: dict[str, int] = {}
    for node in nodes:
        label = node.label.strip()
        base = f'"{label}"' if label else f"(unnamed {_kind_name(node.kind)})"
        seen[base] = seen.get(base, 0) + 1
        names[node.id] = base if seen[base] == 1 else f"{base} #{seen[base]}"
    return names


def serialize_diagram(doc: DiagramDoc) -> str:
    """The diagram as the LLMs read it: components, connections, free-text notes, and anything left
    unconnected. Deterministic, and blind to layout (see the module docstring)."""
    components = [node for node in doc.nodes if node.kind != "text"]
    notes = [node for node in doc.nodes if node.kind == "text" and node.label.strip()]
    if not components and not notes:
        return "[candidate's diagram]\n(empty canvas)"

    names = _display_names(doc.nodes)
    lines = ["[candidate's diagram]"]

    if components:
        lines.append("Components:")
        for node in components:
            line = f"- {names[node.id]}"
            if node.label.strip():
                line += f" ({_kind_name(node.kind)})"
            if node.notes.strip():
                line += f": {node.notes.strip()}"
            lines.append(line)

    if doc.edges:
        lines.append("Connections:")
        for edge in doc.edges:
            arrow = "<->" if edge.bidirectional else "->"
            line = f"- {names[edge.source]} {arrow} {names[edge.target]}"
            if edge.label.strip():
                line += f": {edge.label.strip()}"
            lines.append(line)

    if notes:
        lines.append("Notes on the canvas:")
        for node in notes:
            lines.append(f'- "{node.label.strip()}"')

    connected = set()
    for edge in doc.edges:
        connected.add(edge.source)
        connected.add(edge.target)
    unconnected = [names[node.id] for node in components if node.id not in connected]
    if unconnected and doc.edges:
        lines.append(f"Unconnected: {', '.join(unconnected)}")

    return "\n".join(lines)


def serialize_stored(raw: dict | None) -> str | None:
    """`serialize_diagram` for a stored `turns.diagram` value (None stays None)."""
    if raw is None:
        return None
    return serialize_diagram(DiagramDoc.model_validate(raw))


if __name__ == "__main__":
    # Offline smoke test: no DB, no LLM.
    sample = DiagramDoc.model_validate({
        "nodes": [
            {"id": "n1", "kind": "client", "label": "Mobile app", "x": 0, "y": 0},
            {"id": "n2", "kind": "load_balancer", "label": "", "x": 100, "y": 0},
            {"id": "n3", "kind": "service", "label": "Feed svc", "notes": "stateless, autoscaled"},
            {"id": "n4", "kind": "service", "label": "Feed svc"},
            {"id": "n5", "kind": "database", "label": "Posts DB", "notes": "Postgres, sharded by user_id"},
            {"id": "n6", "kind": "search", "label": "Search index"},
            {"id": "n7", "kind": "text", "label": "fan-out on write for < 10k followers"},
        ],
        "edges": [
            {"id": "e1", "source": "n1", "target": "n2", "label": "HTTPS"},
            {"id": "e2", "source": "n2", "target": "n3"},
            {"id": "e3", "source": "n2", "target": "n4"},
            {"id": "e4", "source": "n3", "target": "n5", "label": "reads", "bidirectional": True},
        ],
    })
    print(serialize_diagram(sample))
    print()
    print(serialize_diagram(DiagramDoc()))
    moved = sample.model_copy(deep=True)
    moved.nodes[0].x = 999
    print("\nlayout-blind:", serialize_diagram(moved) == serialize_diagram(sample))
    bad_docs = [
        {"nodes": [{"id": "a", "kind": "service"}, {"id": "a", "kind": "cache"}]},
        {"nodes": [{"id": "a", "kind": "service"}], "edges": [{"id": "e", "source": "a", "target": "zz"}]},
        {"nodes": [{"id": "a", "kind": "spaceship"}]},
        {"nodes": [{"id": str(i), "kind": "box"} for i in range(MAX_NODES + 1)]},
    ]
    for bad in bad_docs:
        try:
            DiagramDoc.model_validate(bad)
            print("ACCEPTED (bug):", bad)
        except ValueError as exc:
            print("rejected:", str(exc).splitlines()[0])
