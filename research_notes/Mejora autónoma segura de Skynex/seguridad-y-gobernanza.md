# Mejora autónoma segura de Skynex

## ¿Qué formas de auto-mejora son plausibles y qué amenazas cambian su seguridad?

### Takeaway
La evidencia respalda que un agente puede proponer código, crear herramientas auxiliares y probar cambios dentro de un entorno acotado; no demuestra que la auto-modificación irrestricta sea fiable ni segura. Para Skynex, “mejorar” debería significar generar una propuesta evaluable, no desplegar o modificar globalmente sus propias instrucciones y capacidades sin una persona.

### Cited Findings
- SWE-agent encuentra que una interfaz de acciones limitada, retroalimentación explícita y guardas (por ejemplo, descartar ediciones con errores importantes de sintaxis) ayudan frente a errores de edición; aun así, cerca de la mitad de las trayectorias evaluadas contenían al menos una edición fallida. [SWE-agent, NeurIPS 2024](https://arxiv.org/html/2405.15793v2)
- Live-SWE-agent estudia la creación/modificación de herramientas durante la resolución de tareas y reporta resultados en SWE-bench Verified y SWE-Bench Pro. Es evidencia de viabilidad experimental en benchmarks, no una garantía de seguridad, generalización o beneficio neto en Skynex. [Live-SWE-agent](https://arxiv.org/html/2511.13646v2)
- OWASP identifica la inyección de instrucciones y la agencia excesiva (funcionalidad, permisos o autonomía excesivos) como riesgos de sistemas LLM. Contenido de repositorios, herramientas o respuestas externas puede ser adversarial; por tanto el texto que el agente lee no debe adquirir autoridad de política. [OWASP Top 10 LLM 2025](https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf)
- OWASP recomienda herramientas estrechas en lugar de capacidades abiertas, privilegios mínimos, mediación determinista de cada acción y aprobación humana para operaciones de alto impacto. La aprobación debe mostrar la acción concreta. [OWASP LLM06 Excessive Agency](https://github.com/OWASP/www-project-top-10-for-large-language-model-applications/blob/main/2_0_vulns/LLM06_ExcessiveAgency.md)
- OpenAI advierte que la fiabilidad de tareas individuales no prueba la fiabilidad de largas cadenas de acciones; aprobaciones repetidas pueden generar fatiga, y el sandboxing actual puede ser insuficiente para agentes altamente capaces. [Practices for Governing Agentic AI Systems](https://cdn.openai.com/papers/practices-for-governing-agentic-ai-systems.pdf)

### Inferences
- Una propuesta de cambio debe tratar instrucciones, código y resultados de herramientas como datos no confiables; el propio agente no puede decidir si sus permisos se amplían.
- Las herramientas de autoría de cambios y las herramientas de instalación/despliegue deben ser capacidades distintas. El agente puede editar una rama o artefacto candidato, pero no publicar cambios ni instalar recursos globales.

### Gaps
- Los resultados publicados no evalúan el código, prompts, mecanismos de instalación ni amenazas particulares de Skynex; no permiten inferir una tasa de éxito o seguridad específica del proyecto.

## ¿Qué límites, evaluación, aprobación y reversión harían el proceso gobernable?

### Takeaway
La opción más defendible es un ciclo candidato-revisión: cambios limitados y reversibles, ejecución aislada, pruebas reproducibles y gates explícitos antes de integrar o instalar. Pruebas y monitores reducen riesgo, pero no prueban ausencia de fallos; deben complementarse con límites independientes y revisión humana según impacto.

### Cited Findings
- NIST SSDF recomienda prácticas integradas de desarrollo seguro, proteger componentes contra manipulación, producir software seguro y responder a vulnerabilidades; su perfil para IA generativa complementa el marco. Es guía de proceso, no certificación automática de que un cambio es seguro. [NIST SSDF](https://csrc.nist.gov/projects/ssdf)
- OpenAI describe evaluaciones escalables junto a análisis expertos, threat models, change management con cambios autorizados/documentados/probados/aprobados y procedimientos de rollback; también declara que las evaluaciones puntuales son un límite inferior ante nuevas formas de elicitation. [Preparedness Framework](https://cdn.openai.com/pdf/18a02b5d-6b67-4cec-ab64-68cdfbddebcd/preparedness-framework-v2.pdf)
- NIST AI RMF es voluntario y organiza gestión de riesgos para diseño, desarrollo, uso y evaluación; su perfil de IA generativa adapta las prácticas a riesgos generativos. [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework)
- SWE-agent demuestra una forma concreta de feedback automático: analizar cambios, rechazar ciertas ediciones inválidas y volver a informar al agente. También documenta fallos sustantivos y recuperación decreciente tras errores, por lo que pasar una comprobación sintáctica no equivale a corrección funcional. [SWE-agent](https://arxiv.org/html/2405.15793v2)
- OWASP recomienda que autorización y validación ocurran en código/puntos de política deterministas, no mediante la decisión del LLM; recomienda aprobación humana para operaciones de impacto. [OWASP LLM06](https://github.com/OWASP/www-project-top-10-for-large-language-model-applications/blob/main/2_0_vulns/LLM06_ExcessiveAgency.md)

### Inferences
- Proceso sugerido para Skynex: (1) definir métrica/hipótesis antes del cambio; (2) registrar commit base, prompt/modelo, dependencias, datos de evaluación y configuración; (3) generar diff en rama/checkout desechable sin secretos y con red/permisos mínimos; (4) ejecutar pruebas funcionales, regresión, seguridad y casos adversariales; (5) comparar con baseline y umbrales preacordados; (6) presentar diff, trazas y resultados para aprobación humana; (7) integrar por commit identificado y conservar rollback probado. Mantener configuración global fuera del alcance del agente salvo acción manual autorizada.
- Evaluar con tareas no vistas, casos benignos y ataques de inyección, incluidos contenidos de repositorio/documentación/herramientas; reportar también falsos positivos, regresiones, coste, variabilidad y fallos. Repeticiones y revisión adversarial ayudan a detectar sobreajuste, pero los resultados siguen limitados al corpus y entorno evaluados.
- Lo delegable con menor riesgo: análisis, propuestas de cambios locales de bajo impacto, generación/ejecución de pruebas en sandbox y comparación de resultados. Deben quedar bajo control humano: cambios a permisos, prompts/políticas de confianza, secretos, red, dependencias o instaladores globales, publicación/despliegue, borrado irreversible y cambios que amplíen capacidad o persistencia.

### Gaps
- No se halló evidencia pública que establezca un umbral universal para aprobar automáticamente modificaciones de agentes, ni una técnica capaz de bloquear toda inyección indirecta.
- Un sandbox de contenedor no debe suponerse frontera suficiente frente a exploits del kernel, credenciales montadas, red abierta o canales laterales. El aislamiento real depende de configuración/amenazas y exige validación específica; esta nota no audita el sandbox de Skynex.
- La evaluación de prompts/workflows puede ser no determinista y sensible a modelo, versión y configuración. Sin un conjunto de tareas representativo y una definición de ganancia aceptable, “mejora” no es verificable.
