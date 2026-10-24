---
name: analisis-produccion
description: Análisis de producción de uva de Los Lirios SA — reporte de cosecha por destino, variedad, finca y semana, y comparación entre temporadas. Usar cuando el usuario pida un análisis de producción, un reporte de cosecha o comparar temporadas.
---

# Skill: Análisis de Producción Agrícola — Los Lirios SA

## Cuándo usar esta skill
Cuando Fausto pida un análisis de producción de uva, reporte de cosecha, 
comparación de temporadas, o cualquier tarea relacionada con los datos 
productivos de Los Lirios SA.

---

## Contexto de la empresa

**Los Lirios SA** es una empresa agrícola de San Juan, Argentina, dedicada 
a la producción de uva. Fausto trabaja ahí como Ingeniero Industrial 
a cargo del análisis y seguimiento de producción.

**Fuente de datos principal:**
Google Drive → Spreadsheet "PRODUCCION KG, VENTAS"
URL: https://docs.google.com/spreadsheets/d/1Tbi4uGSTiA61-F2L4Z6Xx527uaj0WV4n4FlxpN3i4nc/edit

**Estructura del archivo:**
- `BASE DE DATOS 2` → registros detallados por remito (temporadas 2025 y 2026)
- `KG 25-26` y `KG 24-25` → resúmenes por variedad y destino
- `Avance cosecha PASA por SEM` → avance semanal de uva pasa
- `Avance cosecha BODEGA-PASA por SEM` → bodega vs pasas por semana
- Otras hojas con datos de terceros, fincas y destinos específicos

**Destinos de producción:**
- Bodega (vino)
- Pasas (deshidratado)
- MI — Mercado Interno (consumo en fresco local)
- EXPO — Exportación (consumo en fresco internacional)
- Rama Pasa / Industria Pasa (Vizcaino, Natural Food)

**Variedades principales:**
Flame, Bonarda, Fiesta, Red Globe, Syrah, Sultanina, Superior, 
Moscatel, Criolla, y otras.

**Fincas y orígenes:**
- Los Lirios (producción propia)
- Terceros (productores proveedores)
- Ubicaciones: Mediagua, Caucete, 9 de Julio

---

## Pasos a ejecutar

### 1. Leer los datos
Acceder al Google Sheets via Drive connector y leer TODAS las hojas 
relevantes antes de comenzar el análisis. No asumir estructura — 
verificar nombres de columnas reales.

### 2. Limpiar y estructurar
- Identificar temporadas presentes (ej: 2024-2025, 2025-2026)
- Unificar unidades (todo en kg)
- Separar producción propia vs terceros
- Separar destinos correctamente (algunos registros pueden tener 
  variantes de nombre: "PASA", "Pasa", "pasa" → unificar)

### 3. Calcular métricas clave
Para CADA temporada disponible:
- Total kg producidos (propios + terceros)
- Total kg por destino (bodega, pasas, MI, expo, industria)
- Total kg por variedad
- Total kg por finca/origen
- Semanas pico de cosecha
- Rendimiento uva fresca → pasa (si hay datos de pasas industrializadas)
- Variación interanual (% cambio vs temporada anterior)

### 4. Estructura del reporte

El documento final debe seguir EXACTAMENTE esta estructura:

---

**ANÁLISIS DE PRODUCCIÓN — LOS LIRIOS SA**
Temporada [AÑO] | Elaborado: [fecha actual]

**1. RESUMEN EJECUTIVO**
- Total producido esta temporada vs temporada anterior
- Variación % interanual
- Destino dominante
- Variedad dominante
- 2-3 observaciones clave en bullets

**2. PRODUCCIÓN POR DESTINO**
- Tabla: Destino | Kg temporada actual | Kg temporada anterior | Variación %
- Gráfico de torta o barras (si la herramienta lo permite)
- Párrafo interpretativo (2-3 oraciones)

**3. PRODUCCIÓN POR VARIEDAD**
- Tabla: Variedad | Kg | % del total | vs temporada anterior
- Top 5 variedades destacadas
- Párrafo interpretativo

**4. PRODUCCIÓN POR FINCA Y ORIGEN**
- Tabla: Finca/Origen | Kg | % del total
- Separar Los Lirios vs Terceros
- Párrafo interpretativo

**5. AVANCE SEMANAL DE COSECHA**
- Tabla de semanas con kg acumulados
- Semana de inicio, pico y cierre de cosecha
- Comparación proyectado vs real si está disponible

**6. INDUSTRIA PASA** (si hay datos)
- Total uva ingresada a industria pasa (kg)
- Total pasas obtenidas (kg)
- Rendimiento promedio (kg uva / kg pasa)
- Desglose por proveedor (Vizcaino, Natural Food, etc.)

**7. CONCLUSIONES**
- Tendencias positivas
- Tendencias negativas o puntos de atención
- Recomendaciones si corresponde

---

### 5. Formato de entrega
- Exportar como archivo Word (.docx) O PDF bien formateado
- Fuente: Calibri 11 o similar
- Tabla de contenidos al inicio
- Números con separador de miles (ej: 1.250.000 kg)
- Fechas en formato DD/MM/AAAA
- Idioma: español (Argentina)

---

## Notas importantes

- Si un dato no está disponible en el archivo, indicarlo explícitamente 
  en el reporte — no inventar ni estimar sin aclararlo.
- Si hay inconsistencias en los datos (ej: totales que no cierran), 
  mencionarlo en una nota al pie de la sección correspondiente.
- Si Fausto pide solo una sección específica (ej: "dame solo el análisis 
  por variedad"), ejecutar solo esa parte sin generar el reporte completo.
- Esta skill se puede combinar con datos históricos si Fausto adjunta 
  archivos de temporadas anteriores.

---

## Prompt de activación rápida

Para ejecutar el análisis completo con un solo mensaje, Fausto puede usar:

```
/analisis-produccion temporada 2026
```

O con parámetros específicos:

```
/analisis-produccion temporada 2026, solo destinos y variedades, 
formato PDF
```
