'use client'

import { ExternalLink, FolderOpen } from 'lucide-react'

const DRIVE_URL = 'https://drive.google.com/drive/folders/1MxSMWMVVuREEyU503G-c16XAjpaTCTFp?usp=drive_link'

export default function DocumentacionEmpresaPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Empresa</h1>
        <p className="text-sm text-gray-500 mt-1">Información institucional de Los Lirios SA.</p>
      </div>

      <a
        href={DRIVE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 shadow-sm p-4 hover:border-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors group"
      >
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#fbfaf6] text-[#7a1f2c] flex-shrink-0">
          <FolderOpen size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900">Drive de archivos de la empresa</div>
          <div className="text-xs text-gray-500">Documentos, fotos y archivos compartidos</div>
        </div>
        <ExternalLink size={16} className="text-gray-400 group-hover:text-[#7a1f2c] flex-shrink-0" />
      </a>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-1.5">Misión</h2>
          <p className="text-sm text-gray-400 italic">(a definir)</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-1.5">Visión</h2>
          <p className="text-sm text-gray-400 italic">(a definir)</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-1.5">Valores</h2>
          <p className="text-sm text-gray-400 italic">(a definir)</p>
        </div>
      </div>
    </div>
  )
}
