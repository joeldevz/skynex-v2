# Bucle de mejora autónoma y evaluación para Skynex

## ¿Qué demuestra la investigación sobre agentes que mejoran sus propios resultados o diseño?

### Takeaway

Hay evidencia de que los bucles de propuesta → ejecución/evaluación → revisión mejoran resultados en tareas acotadas; la evidencia más directa de auto-modificación de agentes procede de Darwin Gödel Machine (DGM), un experimento de investigación con benchmarks y sandbox, no de un sistema general autónomo listo para producción. Para Skynex, esto justifica experimentar con cambios candidatos evaluados fuera de la instalación activa, no habilitar autoedición y despliegue sin revisión.

### Cited Findings

- SWE-agent mostró que el diseño de la interfaz agente-computador afecta materialmente el desempeño. Con GPT-4 Turbo reportó resolución de 12,47% en SWE-bench completo y 18% en Lite; en una ablación de 300 tareas, su interfaz obtuvo 10,7 puntos porcentuales más que un agente de shell básico. Resultados publicados en 2024 y ligados a versiones/modelos/entornos de entonces. [Yang et al., SWE-agent (2024)](https://arxiv.org/abs/2405.15793)
- SWE-bench mide resolución de incidencias GitHub reales en repositorios Python, pero sus autores describieron el benchmark inicial como limitado a Python y como una línea base; no representa todos los lenguajes, dominios ni tareas de ingeniería. [Jimenez et al., SWE-bench (ICLR 2024)](https://openreview.net/forum?id=VTF8yNQM66)
- Self-Refine genera una respuesta, produce crítica y refina iterativamente con el mismo modelo. En siete tareas reportó mejora media cercana a 20 puntos porcentuales frente a generación de una sola pasada; en optimización de código, GPT-4 pasó de 27,3% a 36,0%. No requiere entrenamiento adicional, pero el trabajo mide tareas y criterios concretos y no prueba mejora de un sistema de software desplegado. [Madaan et al., NeurIPS 2023](https://arxiv.org/abs/2303.17651)
- Reflexion convierte resultados/errores en texto de reflexión guardado en memoria episódica para intentos posteriores; reportó 91% pass@1 en HumanEval frente a 80% de GPT-4 en su configuración. Los propios autores registran un límite: en WebShop no encontraron reflexiones útiles ni mejora tras cuatro intentos, atribuyéndolo a la necesidad de exploración diversa. [Shinn et al., NeurIPS 2023](https://proceedings.neurips.cc/paper_files/paper/2023/file/1b44b878bb782e6954cd888628510e90-Paper-Conference.pdf)
- DGM itera modificaciones al propio código del agente, prueba variantes y mantiene un archivo de agentes diversos. Tras 80 iteraciones reporta SWE-bench Verified de 20% a 50% y Polyglot de 14,2% a 30,7% en el benchmark completo (su experimento de selección usó subconjuntos y evaluación escalonada); compara contra variantes sin auto-mejora y sin archivo exploratorio. Los autores informan sandbox y trazabilidad, y explican que no es posible demostrar formalmente que cada modificación sea beneficiosa. [Zhang et al., DGM (2025)](https://arxiv.org/abs/2505.22954); [repositorio del proyecto](https://github.com/jennyzzt/dgm)
- DGM es evidencia de laboratorio, no validación de despliegue autónomo: los autores reconocen el ruido estocástico, usan conjuntos pequeños para cribar candidatos por coste, y restringen el alcance a diseño de agentes con modelos fundacionales congelados (no autoentrenamiento de modelos). Las cifras de benchmark no equivalen a seguridad, mantenibilidad o ausencia de regresiones en un producto. [DGM, secciones 4–5 y apéndices](https://arxiv.org/html/2505.22954v3)
- AlphaEvolve combina propuestas de Gemini con evaluadores automáticos y búsqueda evolutiva. Google DeepMind reporta una heurística desplegada en sus centros de datos que recupera en promedio 0,7% de recursos de cómputo, y una optimización de multiplicación matricial que redujo 1% el tiempo de entrenamiento de Gemini; los ejemplos dependen de evaluadores objetivos y problemas seleccionados, no demuestran auto-modificación general de su agente. [Google DeepMind, AlphaEvolve (14 mayo 2025)](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)

### Inferences

- El bucle con mejor fundamento práctico es el que produce un cambio verificable (tests, compilación, lint, evaluador de tarea) y compara candidato con base fija; reflexión en lenguaje puede ayudar a generar hipótesis, pero no debe actuar como el criterio de aceptación.
- Mantener resultados, artefactos y versiones de candidatos permite reproducir, comparar y volver a una versión conocida. El archivo de DGM ofrece un precedente para diversidad, pero su utilidad fuera del entorno de benchmark sigue siendo una hipótesis.
- Ganancia en una métrica estrecha no prueba mejora global. Skynex necesitaría medir también regresiones, comportamiento en tareas no objetivo, fiabilidad y coste antes de preferir un cambio.

### Gaps

- Los resultados citados no establecen qué tasa de ganancia se obtendría en el código, prompts o workflows concretos de Skynex, ni cuánto costaría un ciclo relevante.
- No hay evidencia citada de un sistema que mejore de manera continua y segura un CLI autoalojado con efectos sobre recursos OpenCode globales; no extrapolar los resultados de benchmarks a ese escenario.

## ¿Qué evaluación y límites prácticos importan para un ciclo seguro en Skynex?

### Takeaway

La evaluación robusta necesita tareas representativas, verificadores independientes y comparación controlada; los benchmarks públicos sirven de señal, no de autorización de despliegue. La evidencia apoya separar generación de candidatos, evaluación aislada y promoción explícita, con límites de permisos y reversión.

### Cited Findings

- SWE-agent evidencia que herramientas e interfaz cambian resultados; su benchmark y cifras corresponden a una configuración concreta y el propio trabajo analiza decisiones de interfaz mediante ablaciones. [Yang et al. (2024)](https://arxiv.org/abs/2405.15793)
- SWE-bench Multimodal reúne 617 tareas de 17 repositorios JavaScript con elementos visuales; sus autores hallan que sistemas punteros de SWE-bench tienen dificultades en ese dominio y que la mejor resolución reportada rondaba 12,2%. Esto ilustra límites de generalización de un benchmark Python/textual. [Yang et al., SWE-bench Multimodal (2024)](https://arxiv.org/abs/2410.03859)
- El trabajo DGM describe evaluación por etapas (10 tareas de funcionalidad, luego subconjuntos mayores y hasta 200 tareas para candidatos fuertes), motivada explícitamente por coste y variabilidad de modelos. Es un filtro eficiente, pero implica que las primeras puntuaciones son estimaciones, no evidencia de desempeño completo. [DGM, versión v3 (2025)](https://arxiv.org/html/2505.22954v3)
- AutoCodeRover informa resultados de ejecuciones repetidas y distingue promedio de la unión de tareas resueltas entre corridas; esa unión puede ser mejor que un único intento, pero no equivale al éxito de una ejecución determinista. El artículo también reporta diferencias al cambiar el entorno Docker de evaluación. [Zhang et al., AutoCodeRover (2024)](https://arxiv.org/abs/2404.05427)
- AlphaEvolve destaca el valor de evaluadores automáticos y resultados de código interpretable, depurable y predecible para facilitar despliegue; su publicación describe casos seleccionados de uso real, no tasas universales de seguridad. [Google DeepMind (2025)](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)

### Inferences

- Propuesta de diseño para Skynex (inferencia, no resultado publicado): ejecutar cada candidato en una copia aislada y desechable; limitar red, credenciales, rutas escribibles y duración; usar un conjunto fijo de pruebas funcionales y casos de regresión, más revisión de diferencias; guardar commit/diff, configuración y resultados; permitir promoción solo mediante una acción humana explícita y conservar rollback.
- Para reducir el sobreajuste, reservar casos no usados para generar o seleccionar el cambio; medir estabilidad en varias corridas cuando el comportamiento sea estocástico; informar coste y fallos junto a tasa de éxito. Un benchmark externo puede complementar, no sustituir, pruebas de producto.
- La primera etapa prudente es sugerencias o PRs locales revisables, no mutar instalación activa ni recursos globales. La promoción separada mantiene la propuesta reversible y respeta la distinción del proyecto entre inicialización local e instalación global.
- Medir una hipótesis por cambio (por ejemplo, tasa de tareas completadas, regresiones, duración/coste) facilita atribuir causa y descartar mejoras aparentes. Si no existe verificador objetivo para un cambio de prompt/workflow, mantener revisión humana y expresar la incertidumbre.

### Gaps

- No se localizaron resultados públicos controlados específicos para auto-mejorar Skynex ni para garantizar que tests locales cubran todos los efectos de los recursos OpenCode.
- La investigación revisada no fija umbrales universales de aceptación, tamaño de conjunto suficiente ni política óptima de permisos; deben derivarse del riesgo y de datos propios, con evaluación humana para atributos difíciles de automatizar.
