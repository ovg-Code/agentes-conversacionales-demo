/* ============================================================
   Definiciones de herramientas para Claude (tool use)
   ------------------------------------------------------------
   Todas llevan strict: true, que exige additionalProperties:false
   y required completo. Así la API garantiza que tool_use.input
   valida exactamente contra el esquema y el ejecutor no recibe
   argumentos inventados.

   La descripción de cada herramienta es parte del prompt: le dice
   al modelo CUÁNDO usarla y qué NO puede hacer sin ella.
   ============================================================ */

/** @type {import('@anthropic-ai/sdk').Anthropic.Tool[]} */
export const TOOL_SCHEMAS = [
  {
    name: 'consultar_catalogo',
    description:
      'Busca estudios en el catálogo de Open Side por nombre o zona del cuerpo. ' +
      'Úsala cuando el paciente mencione un estudio para obtener su identificador exacto ' +
      'antes de cotizar, consultar preparación o agendar. Nunca inventes un estudio_id.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        consulta: {
          type: 'string',
          description: 'Texto del paciente que describe el estudio, p. ej. "resonancia de columna lumbar" o "tac de tórax".'
        }
      },
      required: ['consulta']
    }
  },

  {
    name: 'cotizar_estudio',
    description:
      'Obtiene el precio vigente de un estudio. ES LA ÚNICA FUENTE VÁLIDA DE PRECIOS. ' +
      'Nunca menciones un precio que no venga del resultado de esta herramienta en el turno actual. ' +
      'Si falla, di que no tienes el dato y escala.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        estudio_id: { type: 'string', description: 'Identificador del catálogo obtenido con consultar_catalogo.' },
        con_contraste: { type: 'boolean', description: 'true si el estudio se hará con medio de contraste.' },
        tipo_paciente: { type: 'string', enum: ['privado', 'asegurado'], description: 'Tarifa a aplicar.' }
      },
      required: ['estudio_id', 'con_contraste', 'tipo_paciente']
    }
  },

  {
    name: 'verificar_seguro',
    description:
      'Consulta si Open Side tiene convenio con una aseguradora y si el estudio requiere autorización previa. ' +
      'Nunca confirmes cobertura por tu cuenta: informa únicamente lo que devuelva esta herramienta.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        aseguradora: { type: 'string', description: 'Nombre o id: assa, palig, mapfre, internacional, otra.' },
        estudio_id: { type: 'string', description: 'Identificador del estudio, o cadena vacía si aún no se sabe.' }
      },
      required: ['aseguradora', 'estudio_id']
    }
  },

  {
    name: 'consultar_preparacion',
    description:
      'Devuelve las instrucciones de preparación de un estudio (ayuno, contraste, qué traer). ' +
      'Úsala siempre que el paciente pregunte cómo prepararse y al confirmar una cita.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        estudio_id: { type: 'string' },
        con_contraste: { type: 'boolean' }
      },
      required: ['estudio_id', 'con_contraste']
    }
  },

  {
    name: 'consultar_sedes',
    description: 'Devuelve direcciones, teléfonos y horarios de las sedes de Open Side.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, properties: {}, required: [] }
  },

  {
    name: 'obtener_preguntas_screening_rm',
    description:
      'Devuelve el cuestionario oficial de seguridad de resonancia magnética. ' +
      'Llámala ANTES de empezar a preguntar, para usar la redacción exacta y completa. ' +
      'No inventes preguntas de seguridad ni omitas ninguna.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, properties: {}, required: [] }
  },

  {
    name: 'evaluar_screening_rm',
    description:
      'Evalúa las respuestas del cuestionario de seguridad de resonancia y devuelve ' +
      'aprobado, requiere_revision o bloqueado. LA DECISIÓN ES DE ESTA HERRAMIENTA, NO TUYA: ' +
      'nunca declares apto a un paciente por tu cuenta. Solo puedes agendar una resonancia si ' +
      'devuelve aprobado. Si el paciente responde "no sé" a algo, márcalo como true por precaución.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        marcapasos_o_dai: { type: 'boolean' },
        implante_coclear: { type: 'boolean' },
        clips_aneurisma: { type: 'boolean' },
        neuroestimulador_o_bomba: { type: 'boolean' },
        fragmentos_metalicos: { type: 'boolean' },
        embarazo_o_sospecha: { type: 'boolean' },
        enfermedad_renal: { type: 'boolean' },
        alergia_contraste_previa: { type: 'boolean' },
        claustrofobia: { type: 'boolean' },
        requiere_contraste: { type: 'boolean' }
      },
      required: [
        'marcapasos_o_dai', 'implante_coclear', 'clips_aneurisma',
        'neuroestimulador_o_bomba', 'fragmentos_metalicos', 'embarazo_o_sospecha',
        'enfermedad_renal', 'alergia_contraste_previa', 'claustrofobia', 'requiere_contraste'
      ]
    }
  },

  {
    name: 'registrar_consentimiento',
    description:
      'Registra el consentimiento expreso del paciente para tratar sus datos personales y de salud ' +
      '(Ley 81 de 2019 de Panamá). Obligatorio ANTES de recolectar nombre, cédula o cualquier dato clínico. ' +
      'Solo llámala cuando el paciente haya dicho explícitamente que sí.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        otorgado: { type: 'boolean' },
        texto_mostrado: { type: 'string', description: 'El texto exacto de consentimiento que se le mostró al paciente.' }
      },
      required: ['otorgado', 'texto_mostrado']
    }
  },

  {
    name: 'buscar_cupos',
    description:
      'Consulta disponibilidad real en la agenda. ES LA ÚNICA FUENTE VÁLIDA DE HORARIOS. ' +
      'Nunca ofrezcas una fecha u hora que no venga de esta herramienta. Los cupos caducan en 10 minutos.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        estudio_id: { type: 'string' },
        sede: { type: 'string', enum: ['75E', '76E', 'cualquiera'] },
        preferencia_horario: { type: 'string', enum: ['manana', 'tarde', 'cualquiera'] }
      },
      required: ['estudio_id', 'sede', 'preferencia_horario']
    }
  },

  {
    name: 'agendar_cita',
    description:
      'Crea la cita en la agenda. El sistema verifica por su cuenta que exista consentimiento ' +
      'y, para resonancias, que el screening esté aprobado: si no se cumple, la llamada es rechazada. ' +
      'Necesitas nombre completo y cédula del paciente antes de llamarla.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cupo_id: { type: 'string', description: 'Identificador exacto devuelto por buscar_cupos.' },
        estudio_id: { type: 'string' },
        nombre: { type: 'string' },
        cedula: { type: 'string' },
        aseguradora: { type: 'string', description: 'Nombre de la aseguradora, o "Privado".' }
      },
      required: ['cupo_id', 'estudio_id', 'nombre', 'cedula', 'aseguradora']
    }
  },

  {
    name: 'estado_resultados',
    description:
      'Consulta si el informe de un estudio ya fue firmado por el radiólogo. ' +
      'El informe NUNCA se envía por chat: solo se comparte el enlace al portal seguro.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { cedula: { type: 'string' } },
      required: ['cedula']
    }
  },

  {
    name: 'escalar_humano',
    description:
      'Transfiere la conversación a un agente humano: cambia el estado en Chatwoot de pending a open ' +
      'y deja una nota privada con el contexto. Úsala cuando el paciente lo pida, cuando el screening ' +
      'no sea aprobado, ante un reclamo, cuando una herramienta falle dos veces, o cuando no puedas ' +
      'resolver la consulta. Escalar rápido es mejor que adivinar.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        motivo: {
          type: 'string',
          enum: ['emergencia', 'peticion_paciente', 'screening_no_aprobado', 'seguro_complejo',
                 'baja_confianza', 'reclamo', 'fallo_herramienta', 'fuera_de_alcance']
        },
        prioridad: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        equipo: { type: 'string', enum: ['agenda', 'seguros', 'tecnologia_rm', 'general'] },
        resumen: { type: 'string', description: 'Resumen estructurado para que el agente humano retome sin releer todo.' }
      },
      required: ['motivo', 'prioridad', 'equipo', 'resumen']
    }
  }
];

/** Validación de forma de los esquemas: strict exige additionalProperties:false y required completo. */
export function validarEsquemas() {
  const errores = [];
  for (const t of TOOL_SCHEMAS) {
    const s = t.input_schema;
    if (t.strict !== true) errores.push(`${t.name}: falta strict:true`);
    if (s.additionalProperties !== false) errores.push(`${t.name}: falta additionalProperties:false`);
    const props = Object.keys(s.properties || {});
    const req = s.required || [];
    const faltan = props.filter(p => !req.includes(p));
    if (faltan.length) errores.push(`${t.name}: strict exige required completo; faltan ${faltan.join(', ')}`);
    const sobran = req.filter(r => !props.includes(r));
    if (sobran.length) errores.push(`${t.name}: required menciona propiedades inexistentes: ${sobran.join(', ')}`);
    if (!t.description || t.description.length < 40) errores.push(`${t.name}: descripción demasiado corta`);
  }
  return errores;
}
