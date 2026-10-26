# EmbeddingGemma 2: capacidades verificadas y límites para Skynex

Consulta: 12 octubre 2026. Investigación documental, sin instalar ni ejecutar modelos. WorkflowID=eg2-research-20261012; AttemptID=a1; NodeID=model; BaseCandidateOID=6525caf268462ae88c6163d4a7edafaa4adf69a7; HEAD indicado=e6c60c2e82d2f9b6e8a1edf8fff46a079259bfb4; CandidateOID=null. Las propuestas no autorizan implementación. Los límites de Skynex provienen del brief, no de una auditoría del repositorio.

## ¿Qué capacidades y resultados pertenecen realmente a EG2?

### Takeaway
EG2 amplía el embedding local a código y medios, pero genera vectores, no respuestas, planes ni verificaciones de verdad. Su mejora publicada sobre EG1 es grande en código y prácticamente plana en texto multilingüe.

### Cited Findings
- Lanzamiento 6 octubre 2026; Apache 2.0; arquitectura Gemma 4; 740M parámetros nominales: texto 270M, visión 170M, audio 300M. Modalidades proyectadas a un espacio común de 768 dimensiones; contexto 8.192 tokens. [Anuncio](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/), [ficha EG2](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).
- Usos previstos: recuperación, clasificación con etiquetas predefinidas, clustering, similitud, recomendación, near-duplicates y recuperación de evidencia para fact-checking. La ficha no presenta el embedding como un juez de veracidad. [Ficha EG2](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).
- Resultados publicados en precisión completa, 768d: MTEB multilingual v2 61,36 frente a EG1 61,15; MTEB Code v1 NDCG@10 78,68 frente a 68,76 (+9,92 puntos; aproximadamente +14% relativo). MIEB lite 64,64; MMEB v2 imagen Hit@1 57,28, VisDoc NDCG@5 67,84, vídeo Hit@1 50,67; MSEB retrieval MRR@10 69,54; MAEB 49,39. Son métricas distintas y agregados, no porcentajes intercambiables de exactitud. [Ficha EG2](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).
- MRL admite 768/512/256/128d. A 256d: código 76,18, multilingual 60,41, MMEB overall 56,24 frente a 59,01 completo. A 128d: MMEB 45,65 y MSEB 56,71 frente a 69,54 completo; no es compresión multimodal sin pérdidas. [Ficha EG2](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).
- No confundir con `gemini-embedding-2`: es el modelo del servicio Gemini API, salida nativa 3072d y límites propios (por ejemplo 6 imágenes, audio 180 s, vídeo 120 s, PDF 6 páginas). No son especificaciones de EG2 local. [Gemini API](https://ai.google.dev/gemini-api/docs/embeddings).

### Inferences
- Los benchmarks justifican explorar código y multimodalidad, no prometer routing correcto, detección de bugs o evaluación de calidad en Skynex. No prueban equivalencia funcional de código ni razonamiento causal.
- Una migración desde EG1 u otro proveedor necesita espacio/versionado separado y validación; compartir 768d o nombres de prompts no demuestra alineamiento entre modelos.

### Gaps
- Sin evaluación independiente aquí, intervalos de confianza, métricas de español/código TypeScript de Skynex ni resultados del checkpoint cuantizado en el corpus objetivo. No se verificó qué competidores sustentan todas las afirmaciones comerciales «best-in-class».

## ¿Qué aplicaciones adicionales son plausibles, y dónde termina la similitud?

### Takeaway
El valor adicional está en sugerir organización, etiquetas y candidatos de agentes/skills, no en sustituir reglas, permisos o decisiones humanas. Conviene distinguir cercanía temática de identidad, contradicción o autorización.

### Cited Findings
- La receta oficial aplica zero-shot por máxima similitud con etiquetas. Recomienda `Clustering` para categorías arbitrarias/dominio específico, y `Classification` para tareas estándar como sentimiento; advierte que etiquetas nuevas no funcionan bien con el segundo prompt. [Receta textual](https://ai.google.dev/gemma/docs/embeddinggemma/inference-embeddinggemma-with-sentence-transformers).
- La misma receta muestra textos no relacionados con coseno 0,688 sin prompt y 0,734 con STS. Los scores tienen un baseline alto: 0,8 no significa 80% de confianza o verdad. [Receta textual](https://ai.google.dev/gemma/docs/embeddinggemma/inference-embeddinggemma-with-sentence-transformers).
- El modelo no tiene post-training de alineamiento, safety tuning ni moderación de salida; el proveedor exige salvaguardas de aplicación y evaluación de sesgos. Soporte 100+ idiomas no implica rendimiento uniforme. [Ficha EG2](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2).

### Inferences
Propuestas para Skynex, no capacidades implementadas:
- **Recomendación de agentes/skills:** comparar petición con descripciones y ejemplos usando `Clustering`; devolver top-k con abstención/margen, no activar herramientas automáticamente. Resolver permisos y elegibilidad con reglas externas.
- **Organización de tareas locales:** agrupar por tema, sugerir etiquetas, relacionar solicitudes parecidas y señalar posibles duplicados. No fusionar tareas ni inferir dependencias, prioridades o estado completado por similitud.
- **Curación de recursos:** descubrir skills solapadas o descripciones cercanas para revisión. Hash/diff siguen determinando igualdad/cambios; similitud no demuestra equivalencia ni seguridad de actualización del instalador.
- **Cobertura y outliers:** detectar solicitudes alejadas de ejemplos conocidos para proponer revisión de descripciones o categorías. Distancia no prueba anomalía, riesgo o bug.
- **Memoria advisory:** proponer recuerdos redundantes, agrupaciones o candidatos relacionados sin borrar, promover ni convertir recuerdos en autoridad. Contradicciones requieren análisis adicional.
- **Evidencia multimodal:** relacionar incidencias con capturas, diagramas, fragmentos de grabaciones y notas de voz; conservar originales, página/segmento y timestamp como metadatos. El vector no produce OCR/transcripción, diagnóstico, coordenadas UI ni prueba de que un arreglo funciona.
- **Diversidad de contexto:** seleccionar representantes de clusters para reducir redundancia al preparar contexto de un agente, dejando instrucciones obligatorias y evidencia exacta fuera de ese filtro.

### Gaps
- No hay umbrales universales, tasa de abstención o precisión de estas categorías Skynex. Harían falta ejemplos positivos/negativos, solicitudes fuera de dominio y evaluación por idioma/modalidad; no se ejecutaron tests.

## ¿Qué recetas, runtimes y límites deben preservarse?

### Takeaway
Sentence Transformers dispone de recetas multimodales explícitas; una mención comercial de runtime no prueba paridad. Versiones, prefijos, normalización y muestreo pueden alterar silenciosamente el resultado.

### Cited Findings
- Config oficial exige `sentence-transformers>=6.1.0`: versiones anteriores ignoran orden de diccionarios multimodales y no combinan varias imágenes/textos correctamente. Registra Transformers `5.18.0.dev0` como versión usada, no mínimo garantizado; `default_prompt_name=null`, similitud cosine. [Config distribuida](https://huggingface.co/google/embeddinggemma-2/raw/main/config_sentence_transformers.json).
- Recuperación asimétrica: consulta `SearchQuery` o `CodeRetrieval`, corpus `title: {título} | text: {contenido}`; `Document` usa `title: none`. Similitud usa `STS`/`SentenceSimilarity`; clustering y clasificación aplican el mismo prefijo a ambos lados. Medios sin prefijo. Tras truncar, re-normalizar L2 y mantener dimensión igual en consulta/corpus. BF16 o FP32; FP16 puede causar NaN/degradación silenciosa. [Ficha](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2), [config](https://huggingface.co/google/embeddinggemma-2/raw/main/config_sentence_transformers.json).
- Carga selectiva: texto 270M deshabilitando visión/audio; texto+visión 440M; texto+audio 570M. Configuraciones del mismo checkpoint conservan espacio compatible, sin recalcular embeddings existentes al añadir encoders. [Guía de desarrollo](https://developers.googleblog.com/en/embeddinggemma-2-the-developer-guide/).
- Presupuesto compartido: imágenes 280 tokens (~29), vídeo 140/frame (~58), audio 25/s (~327 s), sin texto acompañante. Vídeo 1 FPS; receta limita por defecto a 32 frames y ofrece muestreo uniforme/truncado. Audio mono 16 kHz. Medios combinados dan un vector, no localizaciones por objeto. [Ficha](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2), [receta multimodal](https://ai.google.dev/gemma/docs/embeddinggemma/multimodal-embeddinggemma-with-sentence-transformers).
- Ollama publica variantes 270/440/570/740M y `/api/embed` textual; sus etiquetas dicen 256K aunque su propio README y ficha Google dicen 8K. Etiquetas de entradas muestran texto/imagen, no receta audio/vídeo. No adoptar 256K ni paridad multimodal como verificados. [Ollama](https://ollama.com/library/embeddinggemma-2).
- Google anuncia Transformers, ST, MLX, vLLM, SGLang, llama.cpp, Ollama, LMStudio, LiteRT y navegador. RAM ~191MB texto/~567MB completo es para pesos cuantizados en Pixel 11 Pro, no garantía de memoria total/latencia en Linux/Node. [Anuncio](https://blog.google/innovation-and-ai/technology/developers-tools/embeddinggemma-2/).

### Inferences
- Mantener identidad de checkpoint, runtime, precisión, prompts, dimensiones y preprocessing junto a índices; no asumir vectores intercambiables entre conversiones/quantizaciones. Truncar ahorra almacenamiento vectorial, no elimina encoders.
- Fragmentar vídeos/audio largos y guardar procedencia; subir FPS o presupuesto visual cambia coste/cobertura. PDFs/diagramas necesitan preparación de páginas/medios; no importar automáticamente el pipeline PDF de Gemini API.

### Gaps
- Sin versiones mínimas verificadas para Transformers/Ollama/llama.cpp, paridad multimodal por backend, latencias locales ni integración Node/TypeScript ensayada. `Summarization`/`Reranking` en config son nombres de prefijos, no motores generativos/cross-encoder.
- Verificación realizada: tres consultas web distintas y `webfetch` de anuncio, ficha, README/config Google, dos recetas, guía, Ollama y Gemini API; contenido accesible y contrastado. Sin comandos shell, instalación, inferencia o cambios de código/configuración.
