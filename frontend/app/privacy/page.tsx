export const metadata = {
  title: 'Política de Privacidad — Los Lirios SA',
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#faf8f5] px-6 py-12">
      <div className="max-w-2xl mx-auto bg-white rounded-lg border border-gray-200 shadow-sm p-8 space-y-6 text-sm text-gray-700 leading-relaxed">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f1a17]">Política de Privacidad</h1>
          <p className="text-xs text-gray-400 mt-1">Los Lirios SA — Sistema de Gestión Agrícola · Última actualización: 27 de julio de 2026</p>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-[#7a1f2c]">1. Qué es esta aplicación</h2>
          <p>
            Este sistema (web y mobile) es una herramienta interna de gestión operativa de Los Lirios SA,
            una finca de producción de uva en Mendoza, Argentina. No es una aplicación de uso público:
            el acceso está restringido a personal autorizado de la empresa (administración, encargados,
            regadores y obreros) mediante usuario y contraseña.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-[#7a1f2c]">2. Qué datos recopilamos</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Datos de cuenta:</strong> nombre, email y rol dentro de la empresa, usados para autenticación y control de permisos.</li>
            <li><strong>Datos operativos cargados por el usuario:</strong> registros de tareas agrícolas, riego, aplicaciones fitosanitarias, cosecha e ingresos/egresos financieros de la empresa.</li>
            <li><strong>Notificaciones push (solo mobile):</strong> un token de dispositivo, usado únicamente para poder enviar avisos operativos dentro de la app.</li>
          </ul>
          <p>La aplicación no accede a la ubicación del dispositivo, contactos, cámara ni galería.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-[#7a1f2c]">3. Para qué usamos estos datos</h2>
          <p>
            Exclusivamente para operar el sistema de gestión agrícola y financiera de Los Lirios SA:
            control de acceso por rol, registro de la actividad productiva de la finca, y reportes/paneles
            para la dirección de la empresa. No usamos estos datos con fines publicitarios ni de perfilado.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-[#7a1f2c]">4. Con quién compartimos datos</h2>
          <p>
            No vendemos ni compartimos estos datos con terceros. Los datos se almacenan en una base de
            datos PostgreSQL gestionada por nuestro proveedor de infraestructura (Railway) y el frontend
            se sirve desde Vercel — ambos actúan solo como proveedores de hosting, sin acceso operativo
            a los datos.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-[#7a1f2c]">5. Seguridad</h2>
          <p>
            Las contraseñas se almacenan con hash (nunca en texto plano). Las conexiones viajan cifradas
            (HTTPS/TLS). El acceso a cada función del sistema está controlado por rol.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-[#7a1f2c]">6. Retención y eliminación de datos</h2>
          <p>
            Los datos de cuenta y operativos se conservan mientras la empresa use el sistema. Un empleado
            que deje de trabajar en Los Lirios SA puede pedir la baja de su cuenta y sus datos personales
            de acceso escribiendo al contacto de abajo.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-[#7a1f2c]">7. Contacto</h2>
          <p>
            Ante cualquier consulta sobre esta política o sobre tus datos, escribir a{' '}
            <a href="mailto:administracion@losliriossa.com" className="text-[#7a1f2c] underline">
              administracion@losliriossa.com
            </a>.
          </p>
        </section>
      </div>
    </main>
  )
}
