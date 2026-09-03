"""Descripciones breves de cada variedad de uva, para la ficha/carta de
trazabilidad. Investigadas con fuentes reales (ver bitacora de la sesion),
no inventadas -- fuente unica, usada tanto por el endpoint JSON como por el
PDF (backend/app/core/pdf_carta.py)."""

VARIEDAD_DESCRIPCIONES: dict[str, str] = {
    "flame": (
        "Uva de mesa sin semilla obtenida en 1961 por el USDA en California, de racimo "
        "grande y baya roja-rojiza de sabor dulce y acidez equilibrada. Precoz y de gran "
        "calidad visual; además de consumo en fresco, es muy apreciada para producir "
        "pasas de alta calidad."
    ),
    "red_globe": (
        "Variedad de mesa desarrollada en la Universidad de California-Davis a mediados "
        "del siglo XX, de baya grande, redonda, piel gruesa color rojo violáceo y pulpa "
        "carnosa. Su piel resistente la hace ideal para transporte y exportación."
    ),
    "fiesta": (
        "Variedad sin semilla creada en Estados Unidos en 1973, de alto rendimiento. En "
        "Argentina se difundió en San Juan y hoy se destaca especialmente por su aptitud "
        "para pasas, además de consumo en fresco."
    ),
    "bonarda": (
        "Uva tinta de origen francés (sinónimo de Corbeau/Douce Noire), la segunda "
        "variedad tinta más plantada de Argentina después del Malbec. Da vinos de color "
        "intenso, taninos suaves y notas frutales; se cultiva sobre todo en Mendoza y "
        "San Juan."
    ),
    "sultanina": (
        "Uva blanca sin semilla (Thompson Seedless), de racimo grande y baya pequeña "
        "ovoide, verde-amarillenta, pulpa firme y poco jugosa. Es la variedad base de la "
        "producción mundial de pasas rubias, aunque también se consume en fresco."
    ),
    "syrah": (
        "Uva tinta de origen francés (valle del Ródano), de baya pequeña y oscura. "
        "Produce vinos de cuerpo pleno, color profundo y taninos marcados, con aromas a "
        "frutos negros y notas especiadas."
    ),
    "aspirant": (
        "Aspirant Bouschet: variedad tintórera creada por Henri Bouschet en 1865, con "
        "pulpa y piel de color rojo intenso (poco común entre las variedades viníferas). "
        "Se usa principalmente para dar mayor intensidad de color en cortes con otras "
        "uvas."
    ),
}
