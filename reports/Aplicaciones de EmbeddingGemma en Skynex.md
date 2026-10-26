# EmbeddingGemma 2 convierte similitud en coordinación

**EmbeddingGemma 2 puede mejorar cómo Skynex clasifica solicitudes, recomienda recursos, organiza tareas y relaciona evidencias, no solo cómo busca información.** La oportunidad inmediata es un asistente local de recomendaciones: ayudar a Thalam a escoger candidatos y detectar trabajo repetido, manteniendo fuera del modelo permisos, aceptación y ejecución. Después vienen agrupación de fallos, selección de ejemplos y curación del catálogo; la asociación de capturas y voz requiere infraestructura nueva. Google publicó EG2 el **6 de octubre de 2026**, con módulos de texto, visión y audio que comparten espacio vectorial. Esa capacidad amplía las entradas posibles, pero los embeddings no razonan sobre código ni certifican seguridad. La investigación documental respalda estos mecanismos; **no hay mediciones de calidad, latencia o ahorro dentro de Skynex** ([anuncio](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/)).

## EG2 aporta modalidades nuevas, no un juez

EG2 tiene 740 millones de parámetros nominales, de los cuales 270 millones corresponden a texto, 170 millones a visión y 300 millones a audio. Produce vectores de 768 dimensiones y admite 512, 256 o 128 mediante truncado y renormalización. Su contexto documentado es **8.192 tokens**. La licencia Apache 2.0 facilita evaluar una integración local; no elimina las obligaciones sobre los datos procesados ([ficha del modelo](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2)).

La mejora publicada frente a EG1 es marcada en MTEB Code: NDCG@10 pasa de 68,76 a 78,68; en MTEB multilingual v2 pasa de 61,15 a 61,36. **Estos resultados no miden routing de agentes, deduplicación de tareas ni diagnóstico.** Para solicitudes textuales, EG2 debe competir con reglas sencillas y otros embeddings, no ganar por novedad. Su diferenciador más claro para este informe es combinar modalidades y cargar solo los encoders necesarios. Las configuraciones selectivas del mismo checkpoint conservan un espacio compatible según Google; eso no establece compatibilidad con EG1 ni con cualquier conversión cuantizada ([guía de desarrollo](https://developers.googleblog.com/en/embeddinggemma-2-the-developer-guide/)).

Clasificar, agrupar y recomendar son **métodos genéricos de embeddings**, no funciones exclusivas de EG2. La receta oficial distingue prefijos de similitud, clustering y clasificación; para categorías propias recomienda `Clustering`, mientras advierte limitaciones de `Classification` con etiquetas nuevas. Coseno alto tampoco equivale a confianza: la receta muestra puntuaciones elevadas incluso entre textos no relacionados ([receta textual](https://ai.google.dev/gemma/docs/embeddinggemma/inference-embeddinggemma-with-sentence-transformers)).

## Diez usos convierten vectores en ayuda concreta

### Coordinar solicitudes y recursos sin ejecutar decisiones

**1. Clasificación de intención y recomendación de agentes.** Comparar la petición con descripciones y ejemplos etiquetados permitiría presentar varios candidatos y abstenerse cuando el margen sea pequeño. «La actualización rompe el perfil» podría sugerir diagnóstico antes que implementación. El valor sería reducir derivaciones equivocadas y mostrar solicitudes compuestas; el límite es que «revisa» y «no modifiques» deben respetarse mediante análisis y reglas externas. Hoy existe un clasificador TypeSafe jev-1.13.0 con validación de elecciones y probabilidades; EG2 sería una alternativa experimental o una señal auxiliar, **no un reemplazo compatible demostrado** (`targets/opencode/resources/native/plugins/skynex-runtime.ts:68-128,240-296`). Decision Maker documenta clasificación mediante candidatos precalculados, pero su API y calibración en Skynex siguen sin comprobarse ([Decision Maker](https://ai.google.dev/edge/mediapipe/solutions/decision/decision_maker)).

**2. Recomendación de skills y curación del catálogo.** Representar descripciones y ejemplos de cada skill permitiría sugerir herramientas pertinentes y detectar descripciones solapadas. Ante «quiero analizar pruebas frágiles», Skynex podría mostrar candidatas y sus diferencias, en vez de activar la primera coincidencia. Esto ayudaría a mantener un catálogo comprensible; similitud no prueba que dos skills sean intercambiables ni seguras. Thalam ya exige briefs y límites explícitos (`targets/opencode/resources/canonical/agents/thalam.md:238-267`), pero el resolver completo no fue inspeccionado. La selección semántica sería una adición; hashes, diffs y reglas conservarían la autoridad del instalador.

### Ordenar trabajo y fallos sin inventar estado

**3. Duplicados sugeridos de tareas.** Comparar resúmenes normalizados dentro del mismo proyecto permitiría señalar «esto se parece a la tarea existente». Dos solicitudes sobre el mismo error de perfil podrían revisarse juntas antes de crear trabajo redundante. Actualmente la identidad se obtiene por slug y sufijos numéricos, no por similitud (`packages/tasks/src/service.ts:100-119,363-374`). El valor es evitar repetición; el límite es conservar IDs, responsables y criterios: «actualizar» y «revertir actualización» pueden ser cercanas y opuestas. Nunca fusionar automáticamente.

**4. Mapas temáticos y etiquetas del notebook.** Agrupar tareas permitiría visualizar frentes como instalación, perfiles o calidad de pruebas, y etiquetar nuevas entradas. Es organización de trabajo, **no búsqueda de documentos ni memoria**. El notebook ya conserva alcance, criterios y evidencia (`packages/tasks/src/service.ts:337-347`); la vista temática sería nueva. K-means, clustering aglomerativo o comunidades por coseno son mecanismos disponibles, pero obligan a elegir granularidad. Los grupos no demuestran dependencias ni autorizan priorización o reanudación: Thalam excluye esas funciones del notebook (`targets/opencode/resources/canonical/agents/thalam.md:146-150`; [clustering](https://sbert.net/examples/sentence_transformer/applications/clustering/README.html)).

**5. Familias de fallos y avisos de novedad.** Embeddings de descripciones sanitizadas, combinados con códigos y versiones exactos, ayudarían a agrupar bloqueos y separar entradas atípicas. Varios errores al previsualizar perfiles podrían formar una familia para revisión. Hay motivos de bloqueo y findings estructurados (`packages/tasks/src/service.ts:311-330`; `targets/opencode/resources/canonical/agents/verifier.md:198`), pero no se confirmó un almacén histórico de fallos. El valor sería orientar el triage; una anomalía significa distancia respecto al historial, **no causa, regresión ni vulnerabilidad**. Cambios de vocabulario también producen novedad.

### Preparar mejores investigaciones y revisiones

**6. Ejemplos diversos para briefs de agentes.** Seleccionar representantes de grupos reduciría ejemplos redundantes sin sacrificar variedad: una solicitud sobre actualización recibiría casos de colisión, cancelación y configuración obsoleta, no cinco variaciones del mismo caso. Complementaría los briefs compactos existentes (`targets/opencode/resources/canonical/agents/thalam.md:238-267`). Su valor es diversidad del contexto, no una promesa de menos tokens. Instrucciones obligatorias, restricciones y evidencia exacta quedarían fuera del filtro; un ejemplo lejano puede contener la excepción decisiva.

**7. Pruebas candidatas y casos límite.** Comparar la descripción de un cambio con contratos de pruebas permitiría sugerir escenarios pertinentes: cambiar confirmaciones de perfil debería recordar cancelación, plan obsoleto y ausencia de mutación. Es una ayuda a diseñar o revisar pruebas, no búsqueda general de código. La afinidad semántica debe combinarse con API y plataforma exactas. **No excluiría suites obligatorias ni probaría completitud**: dos pruebas parecidas pueden cubrir ramas distintas. La investigación no acredita un selector existente ni mejora de cobertura; sería una adición evaluable.

**8. Detección de huecos del catálogo.** Medir solicitudes repetidas que quedan lejos de ejemplos conocidos permitiría proponer nuevas descripciones, etiquetas o recursos. Si peticiones sobre accesibilidad quedan sistemáticamente sin candidata clara, aparece una señal para revisar el catálogo. El valor sería evolucionar Skynex desde demanda observada, no desde intuición. Distancia también puede reflejar idioma o mala redacción; no justifica crear agentes automáticamente. No hay corpus longitudinal validado y debe evitarse conservar prompts sensibles innecesariamente.

### Relacionar evidencia nueva y reutilizar solo lo seguro

**9. Asociación multimodal de incidencias.** Un espacio compartido permitiría vincular «el diálogo queda bloqueado» con una captura y una explicación hablada, o agrupar grabaciones de fallos visualmente parecidos. El valor sería organizar evidencia que hoy exige descripción manual. **No se confirmó una frontera de ingestión de adjuntos en el código inspeccionado**: requeriría preparación de medios, almacenamiento y serving nuevos. EG2 no entrega coordenadas UI, OCR fiel, transcripción ni verificación funcional. La receta documenta audio mono a 16 kHz y vídeo muestreado, con presupuesto compartido; los originales, timestamps, dispositivo y revisión deben acompañar al vector ([receta multimodal](https://ai.google.dev/gemma/docs/embeddinggemma/multimodal-embeddinggemma-with-sentence-transformers)).

**10. Caché semántica muy acotada.** Comparar preguntas con entradas previas permitiría reutilizar explicaciones estáticas revisadas. El beneficio sería evitar generación repetida, no mejorar recuerdo; comienza mejor con embeddings del catálogo precalculados y caché exacta. Reutilizar conclusiones sobre código dinámico es peligroso: exige identidad exacta de proyecto/worktree, hashes incluyendo cambios sin commit, dependencias relevantes y versiones de prompt, modelo y política. Si se desconoce alguna dependencia, hay miss; **TTL no sustituye identidad de estado**. Patches, comandos, autorizaciones y resultados de pruebas quedarían excluidos. Redis documenta filtros y umbrales, no ahorros trasladables a Skynex ([caché semántica](https://redis.io/docs/latest/develop/use-cases/semantic-cache/)).

## Tres pilotos separan utilidad real de entusiasmo

Esta prioridad es un juicio de diseño, no rendimiento observado. El riesgo supone recomendaciones revisables y ausencia de mutaciones automáticas.

| Uso propuesto | Impacto | Esfuerzo | Riesgo | Prioridad |
|---|---|---|---|---|
| Intención/agentes | Alto | Medio | Medio | Piloto 1 |
| Duplicados de tareas | Medio-alto | Bajo-medio | Bajo | Piloto 2 |
| Skills/curación | Medio-alto | Medio | Bajo-medio | Piloto 3 |
| Mapas temáticos | Medio | Bajo-medio | Bajo | Después |
| Familias de fallos | Medio-alto | Medio | Medio | Después |
| Ejemplos diversos | Medio | Medio | Medio | Después |
| Pruebas candidatas | Medio | Medio | Medio | Después |
| Huecos del catálogo | Medio | Medio | Medio | Tras acumular datos |
| Evidencia multimodal | Potencial medio-alto | Alto | Medio-alto | Tras validar serving |
| Caché de respuestas | Incierto | Alto | Alto | Última |

**Piloto 1: routing en modo observación.** Etiquetar solicitudes españolas e inglesas, compuestas y fuera de dominio; comparar EG2 con reglas y el clasificador actual sobre datos separados. Medir macro-F1, precisión top-k, precisión sin abstención y cobertura, además de p50/p95 y RAM. Incluir negaciones y autorización citada frente a actual. El criterio de avance sería mejorar utilidad sin ocultar incertidumbre ni convertir etiquetas en permisos.

**Piloto 2: duplicados revisables.** Etiquetar pares reales y pares difíciles con objetivos opuestos; comparar con coincidencia exacta y similitud léxica. Medir precisión/recall, falsos duplicados y utilidad de revisión. Separar familias entre evaluación y ajuste para evitar fuga. No hace falta fusionar nada para demostrar valor.

**Piloto 3: recomendador de skills.** Evaluar top-k con el catálogo versionado, abstención y ejemplos deliberadamente solapados. Medir relevancia por revisión, omisión de candidatas apropiadas y sugerencias incompatibles con restricciones exactas. Si no supera descripciones y keywords, mejorar el catálogo antes que entrenar. No elegir modelos de Sky Agents por similitud del nombre: sus asignaciones necesitan evidencia de capacidad y coste, y la preview está ligada a digest (`packages/sky-agents/src/profiles.ts:12-19`; `packages/sky-agents/src/index.ts:21`).

## La arquitectura debe separar semejanza y autoridad

El esquema propuesto es **entrada minimizada → encoder local versionado → vectores con procedencia → ranking/clustering → filtro determinista de elegibilidad → sugerencia explicable a Thalam o UI → decisión autorizada por separado**. Se añadiría un adaptador opcional, inicialmente textual, fuera del instalador y sin convertir Tasks en scheduler ni Neurox en estado de ejecución. Modelo, checkpoint, dimensión, precisión, prefijos y normalización deben identificar cada espacio; no mezclar vectores por compartir tamaño.

El serving multimodal sigue abierto. La configuración exige Sentence Transformers ≥6.1.0 para manejar correctamente combinaciones multimodales ([configuración distribuida](https://huggingface.co/google/embeddinggemma-2/raw/main/config_sentence_transformers.json)). Ollama muestra etiquetas de 256K mientras su README y Google indican 8K; tampoco quedó demostrada paridad audio/vídeo. **No adoptar 256K ni asumir que `/api/embed` cubre todas las modalidades** ([Ollama](https://ollama.com/library/embeddinggemma-2)). Procesar localmente no anonimiza capturas, voz ni vectores: consentimiento, minimización y retención siguen siendo necesarios.

### Conclusión y alcance de la evidencia

La decisión útil no es «integrar EG2 en todo», sino comprobar si un módulo consultivo mejora tres decisiones repetidas: qué recurso recomendar, qué trabajo ya existe y dónde se solapa el catálogo. Si esos pilotos no superan baselines sencillos, multimodalidad y caché no compensan la complejidad. El criterio arquitectónico permanece: **la semejanza propone; las reglas y la evidencia autorizan**.

Síntesis del 12 de octubre de 2026, basada en las notas `modelo.md`, `aplicaciones.md` y `repositorio.md`. Fuentes documentales verificadas por los investigadores, sin inferencia ni pruebas locales. Las referencias de repositorio no equivalen a auditoría completa. Linaje inicial: WorkflowID=`eg2-research-20261012`, AttemptID=`a1`, NodeID=`report`, BaseCandidateOID=`6525caf268462ae88c6163d4a7edafaa4adf69a7`, HEAD del brief=`e6c60c2e82d2f9b6e8a1edf8fff46a079259bfb4`. Durante la investigación el HEAD cambió a `fc2e6bde0cbb12a84cd9531267c2ba6b94d9680f`, árbol `9890f055975f9ef7703d570b724692e6ccde888e`. El coordinador abrió ronda `a2`: comparó las rutas citadas entre ambas bases, confirmó que solo `packages/tasks/src/service.ts` cambió entre ellas, releyó ese archivo y actualizó sus referencias. No se adoptaron cambios de implementación. Persisten brechas de calibración, hardware, cuantización, integración TypeScript y serving multimodal. CandidateOID=`null`: informe no rastreado, sin crear un objeto Git.
