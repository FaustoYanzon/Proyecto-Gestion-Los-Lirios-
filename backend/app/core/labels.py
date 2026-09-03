"""Diccionarios de etiquetas legibles para enums de produccion/parcela,
compartidos entre el endpoint JSON de trazabilidad y la carta en PDF -- antes
vivian solo en pdf_carta.py, movidos aca para que las dos salidas usen
exactamente el mismo texto."""

TIPO_LABELS = {"parral": "Parral", "potrero": "Potrero", "pasero": "Pasero", "cabezal": "Cabezal"}

FINCA_LABELS = {"los_mimbres": "Los Mimbres", "media_agua": "Media Agua", "caucete": "Caucete"}

TIPO_RIEGO_LABELS = {"goteo": "Goteo", "manto": "Manto"}

DESTINO_LABELS = {
    "MI": "Mercado Interno", "BODEGA": "Bodega", "EXPO": "Exportación", "PASAS": "Pasas",
    "RAMA_PASA": "Rama Pasa", "SEMILLA": "Semilla", "DESC": "Descarte", "FARDO": "Fardo",
}

UNIDAD_LABELS = {
    "dias": "días", "plantas": "plantas", "melgas": "melgas", "metros": "metros",
    "vines": "vines", "cajas": "cajas", "gamelas": "gamelas", "otros": "otros",
}

ORIGEN_ANALISIS_LABELS = {"propio": "Medición propia", "laboratorio": "Informe de laboratorio"}

ESTADO_SANITARIO_LABELS = {
    "sano": "Sano", "con_observaciones": "Con observaciones", "rechazado": "Rechazado",
}

COMPLIANCE_LABELS = {"cumplido": "Cumplido", "incumplido": "Incumplido", "pendiente": "Pendiente"}
