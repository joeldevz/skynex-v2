# EG2 para ingeniería de código: evidencia y límites

## 1. ¿Qué está demostrado específicamente para EG2?

### Takeaway
EG2 tiene evidencia publicada de ranking de código y una demostración de recuperación para un agente; eso no demuestra mejoras en refactorización, revisión, selección de tests ni equivalencia funcional. Los resultados siguientes de otros sistemas no son resultados de EG2.

### Cited Findings
- La ficha oficial informa MTEB Code v1, **Mean(Task), NDCG@10: 78,68**, frente a 68,76 de EG1, con checkpoint de precisión completa. Son 9,92 puntos de ranking, no un porcentaje de bugs corregidos ni de productividad. Ofrece contexto de 8.192 tokens y embeddings de 768 dimensiones, y prefijos distintos para recuperación de código, clustering y similitud. No presenta benchmarks de impacto, clones, revisión o tests. [Ficha EG2](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).
- Google muestra indexar `transformers` con EG2 textual y consultar mediante Gemma 4 26B A4B en el harness Pi. Es evidencia de una integración de recuperación para agentes; el texto localizado no publica una comparación controlada de éxito de edición con/sin EG2. [Guía oficial](https://developers.googleblog.com/en/embeddinggemma-2-the-developer-guide/).
- La ficha describe clasificación, clustering y duplicados como **usos potenciales**, no como validaciones de arquitectura o equivalencia de programas. [Ficha EG2](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).

### Inferences
- Es razonable investigar EG2 como proveedor de candidatos/contexto. Trasladar resultados de otros modelos requiere validar lenguaje, granularidad, corpus, prefijos y consumidor del contexto.

### Gaps
- No se encontró, en esta búsqueda acotada, evaluación EG2 de los seis usos discutidos más allá de recuperación; tampoco medición en Skynex. Ausencia de evidencia localizada no significa imposibilidad.

## 2. ¿Qué usos tienen respaldo empírico en otros modelos o sistemas?

### Takeaway
Hay resultados concretos para generación contextual, localización, clasificación de clones y recuperación arquitectónica. Dependen de pipelines especializados; no justifican atribuir esas capacidades a una similitud coseno de EG2.

### Cited Findings
- **Contexto para generación/reutilización:** RepoCoder combina recuperación por similitud y generación iterativa, evaluando completar líneas, invocaciones y cuerpos de funciones. Es evidencia de completar con contexto del repositorio, no de reutilización automáticamente segura. [RepoCoder, EMNLP 2023](https://aclanthology.org/2023.emnlp-main.151/).
- **Cuándo recuperar:** Repoformer evalúa RepoEval, CrossCodeEval y CrossCodeLongEval; su retriever principal es **Jaccard lexical**, con extensión a recuperación densa en apéndice E.3. Evalúa similitud de edición y métricas de ejecución; encuentra contextos inútiles o perjudiciales y aprende a abstenerse. Por tanto, las mejoras de este sistema no prueban que embeddings superen búsqueda lexical, ni que recuperación siempre ayude. [Repoformer, ICML 2024](https://arxiv.org/html/2403.10059).
- **Clones:** GraphCodeBERT utiliza código y flujo de datos, y ajuste supervisado para clasificación binaria. En BigCloneBench informa precisión 0,948, recall 0,952 y F1 0,950. Es rendimiento de un clasificador ajustado en ese dataset, no de EG2 sin entrenamiento. [GraphCodeBERT, §5.2 y apéndice C](https://arxiv.org/abs/2009.08366).
- **Tipo 4:** FA-AST añade control/flujo de datos al AST y aprende representaciones con GNN. BigCloneBench agrupa clones débilmente tipo 3/tipo 4; en Google Code Jam se asumen mayormente tipo 4 los pares que resuelven el mismo problema. Esa etiquetación no equivale a demostrar identidad de efectos, excepciones o comportamiento para todas las entradas. [FA-AST](https://ar5iv.labs.arxiv.org/html/2002.08653).
- **Localización:** LocAgent construye un grafo de archivos, clases, funciones, imports, invocaciones y herencia; combina nombres exactos, BM25 y navegación multi-hop con un LLM. Compara BM25 y E5/Jina-Code/CodeSage/CodeRankEmbed en SWE-bench Lite y Loc-Bench. La métrica estricta exige encontrar todas las localizaciones relevantes dentro del top-k. Esto valida localización respecto a parches conocidos, no exhaustividad del impacto transitivo. [LocAgent, §§3–5](https://arxiv.org/html/2503.09089v2).
- **Tests realmente afectados:** Ekstazi rastrea dependencias dinámicas de tests sobre archivos; su estudio utiliza 615 revisiones de 32 proyectos Java. No depende de similitud entre código y descripción del test. [Paper ISSTA 2015](https://dl.acm.org/doi/10.1145/2771783.2771784); [implementación](https://github.com/gliga/ekstazi/).
- **Revisión verificable:** CodeQL representa rutas entre fuentes y destinos con condiciones explícitas de flujo/taint. Una alerta tiene una relación analítica explicable, distinta de recuperar ejemplos parecidos. [Documentación primaria](https://codeql.github.com/docs/writing-codeql-queries/creating-path-queries/).
- **Arquitectura:** GAER evalúa diez sistemas contra mapas de referencia: integra grafo heterogéneo de dependencias, identificadores embebidos con Word2Vec y carpetas; aprende embeddings de nodos y los agrupa. Es evidencia de arquitectura recuperada con varias señales, no de que clusters semánticos aislados sean módulos correctos. [GAER, 2026](https://dl.acm.org/doi/pdf/10.1145/3808187).

### Inferences
- Mecanismo candidato para Skynex, **no implementación aprobada**: recuperar funciones/documentación por EG2 y BM25; fusionar candidatos; usar AST/LSP/referencias para expandir relaciones; rerankear según tarea; entregar contexto con rutas y revisión exacta al agente. Cada etapa necesita evaluación separada.
- Similitud temática puede proponer clones o ejemplos de review, pero diferencias pequeñas en permisos, validación, concurrencia o efectos invalidan una sustitución.

### Gaps
- No se encontró evidencia primaria específica de EG2 enlazando código con tests ni detectando inconsistencias de review. Completion publicado tampoco valida edición multiarchivo arbitraria.

## 3. ¿Qué afirmaciones anteriores deben corregirse y cómo evaluarlas?

### Takeaway
La formulación defendible es «priorizar candidatos para una tarea», no «determinar automáticamente corrección, impacto o arquitectura». Todos los beneficios locales de EG2 siguen siendo hipótesis.

### Cited Findings
| Uso previo | Veredicto y corrección |
|---|---|
| Reutilizar código | **Supported en otros sistemas** para contexto de completion; **hypothesis EG2**. Compatibilidad contractual y edición segura no demostradas. [RepoCoder](https://aclanthology.org/2023.emnlp-main.151/) |
| Duplicados semánticos | **Supported especializado**, **hypothesis EG2** como shortlist; **unsupported** declarar equivalencia funcional por coseno. [GraphCodeBERT](https://arxiv.org/abs/2009.08366) |
| Impacto del cambio | **Supported** localización/grafos; **hypothesis EG2** como entrada. **Unsupported** lista exhaustiva de afectados basada solo en vecinos. [LocAgent](https://arxiv.org/html/2503.09089v2) |
| Inconsistencias de revisión | **Hypothesis** recuperar patrones; **unsupported** detectar violaciones/corrección automáticamente con EG2. Reglas, linters y análisis tienen otro mecanismo. [CodeQL](https://codeql.github.com/docs/writing-codeql-queries/creating-path-queries/) |
| Sugerir tests | **Hypothesis** candidatos relacionados; **unsupported** omitir tests por distancia vectorial. Impacto exige dependencias/ejecución y límites explícitos. [Ekstazi](https://dl.acm.org/doi/10.1145/2771783.2771784) |
| Clusters arquitectónicos | **Supported** sistema multiseñal; **hypothesis EG2** organización temática; **unsupported** inferir dependencias o límites normativos desde clusters. [GAER](https://dl.acm.org/doi/pdf/10.1145/3808187) |

### Inferences
- Comparar **grep/nombres exactos** para símbolos conocidos; **BM25/Jaccard** para solapamiento lexical; **EG2** para consultas conceptuales; **AST/LSP/call graph** para relaciones estructurales. Reranking reordena relevancia, no prueba contratos ni completa grafos.
- Evaluación propuesta, no ejecutada: mismos snapshots, consultas, presupuesto y agente; comparar lexical, EG2, híbrido y grafo. Medir recall@k de archivos/funciones y recuperación completa por tarea; precisión y falsos positivos de clones con negativos casi idénticos; recall de tests afectados frente a ejecución completa; resolución real/pass@1 y regresiones para agentes; latencia/coste. Separar ranking de éxito final y medir daños por contexto irrelevante.

### Gaps
- Ninguna cifra de estos papers autoriza porcentajes de beneficio en Skynex. No se instalaron modelos ni se ejecutaron código, tests o benchmarks locales. Investigación: seis búsquedas y seis URLs recuperadas; el extractor de GraphCodeBERT devolvió principalmente abstract, complementado por los pasajes detallados del resultado de búsqueda.
