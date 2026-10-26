# Aplicaciones de embeddings más allá de búsqueda/RAG en Skynex

WorkflowID=eg2-research-20261012; AttemptID=a1; NodeID=applications; BaseCandidateOID=6525caf268462ae88c6163d4a7edafaa4adf69a7; HEAD proporcionado=e6c60c2e82d2f9b6e8a1edf8fff46a079259bfb4; CandidateOID=null. Investigación documental, 12 octubre 2026; propuestas, no funciones implementadas ni resultados medidos de Skynex.

## 1. ¿Qué mecanismos publicados permiten clasificar tareas y recomendar agentes/skills?

### Takeaway
La aplicación inicial más prometedora es un copiloto de clasificación y routing **consultivo**, no un ejecutor. Decision Maker ofrece una arquitectura concreta; su disponibilidad publicada no demuestra calibración, compatibilidad operacional ni exactitud en tareas de Skynex.

### Cited Findings
- Google anuncia EG2 multimodal, modular: 270M parámetros textuales, encoders opcionales de visión/audio, 740M completos, vectores de 768 dimensiones truncables a 512/256/128. Publica MTEB Code 78,68 frente a 68,76 anterior: ese benchmark no mide elección de agentes, caché segura ni suficiencia de pruebas. — [Google, 6 octubre](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/)
- Decision Maker documenta `ChoiceQuestion`, `BooleanQuestion`, `ScoreQuestion`; devuelve etiquetas, distribuciones y puntuaciones esperadas sin generar texto. Para bi-encoders, `prewarm` calcula embeddings de opciones, whitening respecto al centroide de la pregunta y normalización L2; luego puntúa contexto contra candidatos precalculados. — [Google AI Edge](https://ai.google.dev/edge/mediapipe/solutions/decision/decision_maker)
- Su guía web publica `ClassifierSchema`, `prewarm`, `classify` y evaluación individual, con ejemplos de routing por descripciones. El umbral booleano de ejemplo es 0,5, no una recomendación validada para agentes de código. — [Guía web](https://ai.google.dev/edge/mediapipe/solutions/decision/decision_maker/web_js)
- SetFit es otra técnica genérica: fine-tuning few-shot de Sentence Transformers y cabeza clasificadora. No equivale a simplemente guardar ejemplos, ni su resultado en sentimiento demuestra rendimiento de EG2. La documentación de Sentence Transformers explica que clasificación, similitud y búsqueda requieren nociones diferentes de semejanza. — [SetFit](https://github.com/huggingface/setfit); [Training overview](https://www.sbert.net/docs/sentence_transformer/training_overview.html)

### Inferences
- **Propuesta zero-shot:** descripciones versionadas de diagnóstico, planificación, implementación, revisión y documentación; devolver intención, top-k agentes/skills y evidencia textual relevante. Añadir `otro/no determinado`. Una tarea compuesta no debe forzarse a una sola opción: separar subtareas o evaluar varias etiquetas binarias, conservando la abstención.
- **Propuesta few-shot sin entrenamiento:** comparar con ejemplos etiquetados o centroides por clase; alternativamente entrenar una cabeza sobre embeddings congelados. Son propuestas metodológicas, no APIs few-shot verificadas de Decision Maker. Comparar ambas con reglas/keywords y zero-shot antes de proponer fine-tuning.
- Precalcular únicamente descripciones/ejemplos estáticos. Versionar modelo, dimensión, normalización y catálogo; recalcular cuando cambien. El estado dinámico —recursos instalados, permisos, tarea vigente— se comprueba por interfaces deterministas antes de presentar recomendaciones aplicables.
- Seleccionar umbral y margen top-1/top-2 en validación separada; medir precisión condicionada a no abstenerse y tasa de abstención. Coseno no es probabilidad; aunque Google denomine sus salidas calibradas, comprobar calibración local mediante Brier/ECE y curvas riesgo-cobertura.
- Incluir pares adversariales: «ejecuta»/«no ejecutes», «revisar»/«modificar», autorización citada versus autorización actual, excepciones, español/inglés e instrucciones contradictorias. Ninguna etiqueta semántica puede conceder permisos, autorizar instalación, marcar aceptación o sustituir consentimiento.

### Gaps
- No se encontraron evaluaciones EG2 específicas de routing Skynex. Las guías tienen diferencias de superficie (`prewarmChoice`/`prewarm`, campos de resultado); el overview agrupa 270M/300M y no refleja claramente los 740M multimodales del anuncio. El módulo textual explica parte de la diferencia, pero no verifica cada artefacto. No tratar snippets como integración comprobada.

## 2. ¿Cómo organizar trabajo, fallos y ejemplos sin confundir semejanza con equivalencia?

### Takeaway
Embeddings pueden convertir un notebook en mapas de trabajo y familias de fallos, y proponer ejemplos útiles. El resultado es una agrupación para revisión, nunca prueba de causa común, cobertura o duplicidad jurídica/funcional.

### Cited Findings
- Sentence Transformers documenta k-means con número de clusters prefijado, clustering aglomerativo controlado por umbral y comunidades locales por similitud coseno/tamaño mínimo. Son técnicas genéricas, no benchmarks de EG2 ni mediciones de Skynex. — [Clustering](https://sbert.net/examples/sentence_transformer/applications/clustering/README.html)
- La dependencia de la noción de similitud respecto a la tarea impide extrapolar automáticamente calidad de búsqueda a agrupación o clasificación. — [Training overview](https://www.sbert.net/docs/sentence_transformer/training_overview.html)

### Inferences
| Prioridad/propuesta | Impacto / esfuerzo / riesgo estimados | Evaluación medible propuesta |
|---|---|---|
| 1. Routing consultivo | Alto / medio / medio | Macro-F1; precisión top-k; riesgo-cobertura; errores de negación; p50/p95 y RAM locales |
| 2. Deduplicación sugerida y mapa del notebook | Medio-alto / bajo-medio / bajo si no fusiona | Precisión/recall de pares duplicados etiquetados; falsos merges; utilidad de revisión |
| 3. Familias de fallos y novedad | Medio-alto / medio / medio | Pureza respecto a causas confirmadas; detección de fallos nuevos; falsos avisos por versión |
| 4. Selección de ejemplos/tests candidatos | Medio / medio / medio | Relevancia top-k por revisión; omisiones de casos límite; diversidad; resultado posterior independiente |
| 5. Matching multimodal de evidencias | Potencial medio / alto / medio-alto | Recall@k, falsos enlaces y variantes de idioma/pantalla/audio |
| 6. Caché semántica de respuestas | Incierto / alto / alto | Wrong-hit rate, stale-hit rate, beneficio neto frente a caché exacta |

Estas prioridades son juicio de diseño condicionado al brief, no resultados publicados. Los mecanismos se apoyan en [Decision Maker](https://ai.google.dev/edge/mediapipe/solutions/decision/decision_maker), [clustering](https://sbert.net/examples/sentence_transformer/applications/clustering/README.html) y [caché Redis](https://redis.io/docs/latest/develop/use-cases/semantic-cache/).

- **Dedup:** normalizar resúmenes y proponer pares; conservar IDs, procedencia, responsables y estado. Separar por proyecto/área cuando corresponda. «Actualizar» y «revertir actualización» no se fusionan por cercanía. Nunca borrar/fusionar automáticamente.
- **Fallos:** agrupar mensaje, operación y contexto sanitizado; mantener exactos código de error, dependencia, versión y plataforma. Distancia a clusters previos puede señalar novedad, no diagnosticar una regresión. Un cambio de modelo o vocabulario también produce outliers.
- **Ejemplos/tests:** seleccionar vecinos relevantes y representantes diversos, combinando restricciones exactas de API/plataforma y similitud. Útil para sugerir casos límite o reducir ejemplos repetitivos; no excluir suites obligatorias, afirmar cobertura ni aceptar código. Una prueba muy similar puede verificar una rama distinta.
- Evaluación futura: corpus etiquetado, splits temporales y por repositorio/familia para evitar fuga de duplicados; comparar con hashes, reglas y selección aleatoria/diversa. Registrar desacuerdos humanos, no solo métricas geométricas.

### Gaps
- No hay corpus, tasas de repetición ni etiquetas de Skynex evaluados aquí. Distancia semántica no identifica causalidad, comportamiento ejecutado ni obligaciones de prueba. No se estiman ahorros económicos o temporales.

## 3. ¿Dónde encajan caché y evidencia multimodal, y qué no automatizar?

### Takeaway
La caché segura empieza por entradas estáticas y límites exactos de estado; no por reutilizar conclusiones de agentes. Screenshot+voz puede enlazar evidencias con incidencias, pero la similitud no certifica que la interfaz funcionó.

### Cited Findings
- Redis distingue caché semántica de RAG: almacena respuestas completas. Advierte que umbrales laxos sirven respuestas equivocadas y recomienda fronteras exactas de metadatos junto a similitud y TTL. — [Redis](https://redis.io/docs/latest/develop/use-cases/semantic-cache/)
- RedisVL define distancia coseno en [0,2], menor=más estricto, y ofrece filtros/TTL. Esto precisa la dirección del umbral frente a formulaciones ambiguas del overview: no copiar defaults como umbrales de EG2. — [RedisVL API](https://redis.io/docs/latest/develop/ai/redisvl/api/cache/)
- EG2 anuncia espacio compartido para texto, código, imagen, audio y video; Decision Maker documenta contexto/opciones multimodales, imágenes y audio de 16kHz. Son capacidades publicadas, no pruebas de OCR exacto, transcripción fiel o razonamiento sobre interfaz. — [Anuncio](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/); [Decision Maker](https://ai.google.dev/edge/mediapipe/solutions/decision/decision_maker)

### Inferences
- **Cachear primero:** embeddings de catálogo y análisis de documentos inmutables identificados por hash. Si se explora reutilización de respuestas, limitarla inicialmente a explicación estática, etiquetada como reutilizada; excluir patches, comandos, autorizaciones, aceptación y resultados de tests.
- Una pregunta idéntica sobre código cambiado ya no tiene necesariamente la misma respuesta. Exigir identidad exacta de proyecto/worktree, hashes relevantes incluyendo cambios sin commit, versiones de modelo/prompt/política y configuración aplicable. TTL no detecta un cambio ocurrido hace segundos; dependencias desconocidas implican miss. Cercanía solo propone un candidato dentro de esas fronteras.
- Medir falsos hits con pares que cambian versión, negación, sujeto y estado. Beneficio neto incluye embedding, lookup, comprobaciones, misses y corrección de errores; comparar con caché exacta y sin caché. No trasladar porcentajes comerciales de Redis a Skynex.
- **Multimodal:** enlazar captura de error + explicación hablada con una incidencia; agrupar estados visuales parecidos; sugerir evidencia anterior. Conservar timestamp, revisión, dispositivo, origen y archivo original. Confirmar detalles mediante DOM/accesibilidad, logs, assertions y revisión: pantallas similares pueden tener distinto estado funcional.
- Procesamiento local no elimina riesgo: capturas y voz pueden contener secretos/personas. Minimización, consentimiento y retención explícita preceden al indexing; embeddings tampoco son prueba de anonimización.

### Gaps
- No se verificaron binarios, compatibilidad SDK, latencia, RAM, calibración ni calidad cross-modal en hardware de Skynex. Investigación exclusivamente de fuentes; cero instalaciones, ejecución de modelos, tests o cambios funcionales. La autorización y aceptación permanecen fuera del sistema de semejanza; Neurox permanece memoria consultiva separada.
