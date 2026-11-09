# ELK layout

The same graph five times: three ways of asking for the ELK layout, the
default (also ELK in Mermaid 12), and dagre for comparison.

## init directive

```mermaid
%%{init: {"layout": "elk"}}%%
flowchart TD
  A[Start] --> B{Check}
  B -->|yes| C[Build]
  B -->|no| D[Fix]
  D --> B
  C --> E[Deploy]
  A --> E
  C --> F[Notify]
```

## front matter

```mermaid
---
config:
  layout: elk
---
flowchart TD
  A[Start] --> B{Check}
  B -->|yes| C[Build]
  B -->|no| D[Fix]
  D --> B
  C --> E[Deploy]
  A --> E
  C --> F[Notify]
```

## flowchart-elk

```mermaid
flowchart-elk TD
  A[Start] --> B{Check}
  B -->|yes| C[Build]
  B -->|no| D[Fix]
  D --> B
  C --> E[Deploy]
  A --> E
  C --> F[Notify]
```

## default layout

```mermaid
flowchart TD
  A[Start] --> B{Check}
  B -->|yes| C[Build]
  B -->|no| D[Fix]
  D --> B
  C --> E[Deploy]
  A --> E
  C --> F[Notify]
```

## dagre

```mermaid
---
config:
  layout: dagre
---
flowchart TD
  A[Start] --> B{Check}
  B -->|yes| C[Build]
  B -->|no| D[Fix]
  D --> B
  C --> E[Deploy]
  A --> E
  C --> F[Notify]
```
