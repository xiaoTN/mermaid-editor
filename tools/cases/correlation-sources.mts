// Sources shared by real Mermaid regression tests and the numbered case runner.
export const correlationSources = {
  'preview-class': 'classDiagram\n A --> B: owns\n',
  'preview-state': 'stateDiagram-v2\n A --> B: next\n',
  'preview-er': 'erDiagram\n A ||--o{ B : owns\n',
  'preview-sequence': 'sequenceDiagram\n participant Alice\n participant Bob\n Alice->>Bob: Hello\n Bob-->>Alice: Hi\n',
  'preview-gantt': 'gantt\n dateFormat YYYY-MM-DD\n section Work\n Task :task, 2026-10-20, 2d\n',
  'preview-pie': 'pie\n "One" : 40\n "Two" : 60\n',
  'preview-members': 'classDiagram\n class Account {\n +String name\n +save()\n }\n',
  'node-boundaries': `flowchart TB
  subgraph A["甲"]
    a["节点a"]
  end
  subgraph B["乙"]
    b_a["节点b_a"]
  end
  a --> c
`,
  'cluster-boundaries': `flowchart TB
  subgraph render["云渲染"]
    a
  end
  subgraph other["其他"]
    b
  end
  subgraph m["分组m"]
    c
  end
  subgraph end["分组end"]
    d
  end
  subgraph s["分组s"]
    e
  end
  subgraph s2["分组s2"]
    f
  end
  a --> b --> c --> d --> e --> f
`,
  'edge-collision': `flowchart TB
  a_b -->|第一条| c
  a -->|第二条| b_c
  x --> y
`,
} as const
