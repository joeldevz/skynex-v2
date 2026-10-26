# EmbeddingGemma 2: evidencia específica para recuperación de código

## 1. ¿Qué mide realmente 78.68 y qué permite comparar?

### Takeaway
La ficha oficial confirma **MTEB(Code, v1), Mean(Task), NDCG@10**, no exactitud de programación ni porcentaje de problemas resueltos. La mejora frente a EG1 está documentada; no acredita por sí sola capacidades de ingeniería sobre repositorios completos.

### Cited Findings
- Google identifica expresamente la métrica como «Mean(Task), NDCG@10»: EG2 **78.68**, EG1 **68.76**, con vectores de **768 dimensiones** y checkpoint «full-precision». Hugging Face reproduce los mismos valores. — [Ficha Google](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2); [ficha HF](https://huggingface.co/google/embeddinggemma-2).
- El anuncio dice «9.92-point improvement» y recomienda indexación local, búsqueda semántica y recuperación para agentes. Son aplicaciones propuestas por el fabricante, no mediciones end-to-end de agentes. — [Anuncio](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/).
- MTEB describe esta suite como «Code retrieval quality ... covering code search, text-to-SQL, and code feedback tasks». Su definición pública indexada enumera **12 tareas de Retrieval**: AppsRetrieval, CodeEditSearchRetrieval, CodeFeedbackMT, CodeFeedbackST, CodeSearchNetCCRetrieval, CodeSearchNetRetrieval, CodeTransOceanContest, CodeTransOceanDL, CosQA, COIRCodeSearchNetRetrieval, StackOverflowQA y SyntheticText2SQL. — [MTEB](https://docs.mteb.org/overview/available_benchmarks/#mtebcode-v1); [definición del evaluador](https://github.com/embeddings-benchmark/mteb/blob/main/mteb/benchmarks/benchmarks/benchmarks.py).
- La misma evaluación oficial de EG2 publica **78.68 / 77.24 / 76.18 / 71.41** para **768 / 512 / 256 / 128d**, respectivamente. La ficha exige renormalizar tras truncar y usar dimensiones coincidentes para consultas y documentos. — [Ficha Google](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).

### Inferences
- NDCG@10 evalúa relevancia y posición de los primeros diez resultados respecto a etiquetas; **78.68 no significa 78.68% de código correcto**. «Mean(Task)» es agregación por tarea, no tasa de éxito global ponderada por cada consulta. La suite explícitamente evalúa recuperación, no generación, ejecución ni SWE-bench. — [Ficha](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2); [MTEB](https://docs.mteb.org/overview/available_benchmarks/#mtebcode-v1).
- Cálculo sobre valores publicados: +9.92 puntos, aproximadamente **+14.43% relativo** al score de EG1. No +14 puntos porcentuales de exactitud. Reducir a 256d pierde 2.50 puntos; 128d pierde 7.27, por lo que «mínima pérdida» necesita contextualizarse específicamente para código. — [Ficha](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).
- A igual precisión, 128d ocupa 1/6 del espacio numérico de 768d; no demuestra 6× menos RAM total, menor tiempo de inferencia ni igual calidad. — [Ficha](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).

### Gaps
- No se verificaron resultados EG2 por tarea, revisión fijada del evaluador/datasets, splits, ponderación interna entre subconjuntos lingüísticos, intervalos de incertidumbre ni el harness exacto. La definición actual de MTEB contextualiza la suite; no reproduce el run de Google.
- No hay aquí comparación numérica verificable con otros modelos en idéntico run ni medidas de coste/latencia ligadas al score. El gráfico del anuncio no se transcribió; se evita convertir «best-in-class» en clasificación cuantitativa.

## 2. ¿Incluye texto→código, código→código y recuperación de cambios?

### Takeaway
La suite no es únicamente búsqueda desde lenguaje natural: incorpora recuperación de continuaciones, equivalentes y diffs. Sin embargo, un agregado EG2 no revela en cuál de esas capacidades mejora ni valida análisis causal del impacto de cambios.

### Cited Findings
- CodeSearchNetRetrieval: «retrieve the most relevant code snippet for a given query» en lenguaje natural. El origen CodeSearchNet usa comentarios/docstrings y funciones o métodos en **Python, JavaScript, Ruby, Go, Java y PHP**. — [Dataset MTEB](https://huggingface.co/datasets/mteb/CodeSearchNetRetrieval); [autores CodeSearchNet](https://github.com/github/CodeSearchNet).
- COIR define CodeSearchNet-CCR como recuperar el segmento restante de una función desde su segmento inicial: corte aleatorio con consulta de 40–70% de los caracteres. **No es un benchmark de clones**. CodeTransOcean recupera implementaciones semánticamente equivalentes entre frameworks o entre Python y C++; COIR también incluye código→resumen y QA híbrido texto/código, mono/multiturno. — [Artículo de autores COIR, sección 3.2 y apéndice B](https://aclanthology.org/2025.acl-long.1072.pdf).
- Para CodeEditSearchRetrieval, LightOn documenta «Commit message → Unified diff patch», con Python, JavaScript, TypeScript, Go, Ruby, Java, PHP, C, C++, Rust, Swift, Scala y Shell. Es evidencia primaria de un participante que describe el benchmark, no del run EG2. — [LightOn](https://huggingface.co/blog/lightonai/colgrep-lateon-code).
- La ficha EG2 prescribe **CodeRetrieval**, tarea **asimétrica**: consulta `task: code retrieval | query: {query}`; documento `title: {title or filename} | text: {code}`. `Document` inserta `title: none`; títulos reales requieren formato manual. Similaridad y clustering usan prefijos simétricos diferentes. — [Ficha](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).

### Inferences
- Sí hay evidencia de evaluación agregada sobre una suite con texto→código, código→código, código→texto y mensaje→diff; no es legítimo reducir todo a texto→código. Tampoco «CodeFeedback» equivale a que EG2 escriba feedback: recupera respuestas existentes. — [MTEB](https://docs.mteb.org/overview/available_benchmarks/#mtebcode-v1); [COIR](https://aclanthology.org/2025.acl-long.1072.pdf).
- Recuperar un diff relacionado con un mensaje no identifica necesariamente dependientes afectados, cambios de contratos ni pruebas que fallarán. Recuperar equivalentes tampoco certifica equivalencia semántica, seguridad de reutilización o detección de clones en producción. — [LightOn](https://huggingface.co/blog/lightonai/colgrep-lateon-code); [COIR](https://aclanthology.org/2025.acl-long.1072.pdf).

### Gaps
- Los prefijos de la ficha son recomendaciones de uso; no se pudo comprobar qué prefijos utilizó cada tarea en la evaluación EG2, especialmente código→texto/diff. No se extrapola el prompt de otro modelo.
- No se verificó rendimiento individual EG2 en TypeScript ni consultas en español. «100+ idiomas» no significa 100+ lenguajes de programación ni rendimiento uniforme. — [Ficha](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).

## 3. ¿Qué queda sustentado para ingeniería y qué debe corregirse?

### Takeaway
EG2 es un candidato sustentado para **recuperar contexto de código**. Reutilización segura, clones, impacto, convenciones, pruebas y arquitectura siguen siendo hipótesis de aplicación, no capacidades demostradas por este benchmark.

### Cited Findings
- La ficha entrega embeddings, con **mean pooling**, salida 768d y contexto de **8,192 tokens**, compartido entre modalidades; no una representación ilimitada del repositorio. Reconoce límites ante tareas abiertas/complejas. — [Ficha](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).
- El anuncio separa recuperación EG2 del razonamiento con un modelo generativo: «Pair EmbeddingGemma 2 for local file retrieval with Gemma 4 for contextual reasoning». — [Anuncio](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/).
- Implementación documentada: SentenceTransformers/Transformers, carga textual de 270M excluyendo encoders de visión/audio, `bfloat16` o `float32`; advertencia explícita contra `float16` por NaN/degradación silenciosa. Esto no es una verificación local de compatibilidad. — [Ficha](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).

### Inferences
- Propuesta, no hecho probado: chunking por funciones/clases con nombres, rutas y metadatos; reservar presupuesto para prefijos/contexto y usar dependencias/AST/búsqueda exacta para complementar similitud. Los 8K no garantizan recuperar relaciones entre chunks. — [Límites y formato oficial](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).
- Corrección a la respuesta previa: **NDCG@10 sí queda confirmado**, ahora junto a Mean(Task), v1, 768d y full-precision. Rebajar cualquier afirmación categórica sobre clones/impacto/pruebas/arquitectura a «posible recuperación de candidatos, requiere validación específica». — [Ficha](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2); [MTEB](https://docs.mteb.org/overview/available_benchmarks/#mtebcode-v1).

### Gaps
- No se localizó un informe técnico EG2 verificable en la búsqueda acotada; el paper de EmbeddingGemma de 2025 es v1, no autoridad para metodología v2.
- Verificación 2026-10-12: 5 búsquedas, 6 fetches; fichas y anuncio leídos completos. GitHub devolvió interfaz sin cuerpo; documentación MTEB confirma alcance pero ocultó tablas en fetch (lista obtenida de búsqueda). Fetch de COIR HTML v4 devolvió 404; detalles COIR y LightOn proceden de extractos de búsqueda primaria, no lectura completa. No inferencia, instalación ni pruebas ejecutadas.
