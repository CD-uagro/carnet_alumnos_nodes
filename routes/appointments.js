const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const {
  cleanCosmosDocument,
  createAppointment,
  findActiveAppointmentByMatriculaAndArea,
  findAppointmentByIdForMatricula,
  findAppointmentsByMatricula,
  findCarnetByMatricula,
  findUsuarioByMatricula,
  replaceAppointment
} = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { sendAppointmentConfirmationEmail } = require('../services/mailService');

const CANCELABLE_STATUSES = ['requested', 'confirmed', 'rescheduled'];

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeArea(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, '_');
}

function institutionalDomains() {
  return (process.env.INSTITUTIONAL_EMAIL_DOMAINS || 'uagro.mx,uagro.edu.mx')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isInstitutionalEmail(email) {
  const normalized = normalizeText(email).toLowerCase();
  if (!normalized.includes('@')) return false;
  return institutionalDomains().some((domain) => normalized.endsWith(`@${domain}`));
}

function appendHistory(appointment, fromStatus, toStatus, actor, actorRole, message) {
  const history = Array.isArray(appointment.history) ? appointment.history : [];
  history.push({
    from: fromStatus || null,
    to: toStatus,
    actor,
    actor_role: actorRole,
    message: message || null,
    created_at: nowIso()
  });
  appointment.history = history;
}

function appendSystemNotificationHistory(appointment, event, note) {
  const history = Array.isArray(appointment.history) ? appointment.history : [];
  const timestamp = nowIso();
  history.push({
    event,
    by: 'system',
    at: timestamp,
    note,
    from: appointment.status || null,
    to: appointment.status || 'requested',
    actor: 'system',
    actor_role: 'system',
    message: note,
    created_at: timestamp
  });
  appointment.history = history;
}

async function loadStudentContext(matricula) {
  const [carnet, usuario] = await Promise.all([
    findCarnetByMatricula(matricula),
    findUsuarioByMatricula(matricula).catch(() => null)
  ]);

  if (!carnet) {
    const error = new Error('Carnet no encontrado para la matricula autenticada');
    error.status = 404;
    throw error;
  }

  const carnetEmail = normalizeText(carnet.correo || carnet.email);
  const sessionEmail = normalizeText((usuario && usuario.correo) || carnetEmail);
  if (!sessionEmail || !carnetEmail || sessionEmail.toLowerCase() !== carnetEmail.toLowerCase()) {
    const error = new Error('El correo de sesion no coincide con el correo del carnet');
    error.status = 403;
    throw error;
  }

  if (!isInstitutionalEmail(sessionEmail)) {
    const error = new Error('Se requiere correo institucional para solicitar cita');
    error.status = 403;
    throw error;
  }

  return { carnet: cleanCosmosDocument(carnet), sessionEmail };
}

function appointmentStudentFromCarnet(carnet) {
  return {
    matricula: normalizeText(carnet.matricula),
    nombre: normalizeText(carnet.nombreCompleto || carnet.nombre || carnet.nombre_completo),
    correo_institucional: normalizeText(carnet.correo || carnet.email),
    programa: normalizeText(carnet.programa || carnet.carrera),
    campus: normalizeText(carnet.campus || carnet.escuelaUnidadAcademica || carnet.unidadMedica)
  };
}

router.get('/appointments', authenticateToken, async (req, res) => {
  try {
    const matricula = req.user && req.user.matricula;
    if (!matricula) {
      return res.status(400).json({ success: false, message: 'Matricula no encontrada en token' });
    }

    const appointments = await findAppointmentsByMatricula(matricula);
    res.json({ success: true, data: appointments, count: appointments.length });
  } catch (error) {
    console.error('Error obteniendo appointments:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

router.get('/appointments/:id', authenticateToken, async (req, res) => {
  try {
    const matricula = req.user && req.user.matricula;
    if (!matricula) {
      return res.status(400).json({ success: false, message: 'Matricula no encontrada en token' });
    }

    const appointment = await findAppointmentByIdForMatricula(req.params.id, matricula);
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Cita no encontrada' });
    }

    res.json({ success: true, data: appointment });
  } catch (error) {
    console.error('Error obteniendo appointment:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

router.post('/appointments', authenticateToken, async (req, res) => {
  try {
    const matricula = req.user && req.user.matricula;
    if (!matricula) {
      return res.status(400).json({ success: false, message: 'Matricula no encontrada en token' });
    }

    const area = normalizeArea(req.body.area);
    const reasonCategory = normalizeText(req.body.reason_category || req.body.reasonCategory);
    const reasonText = normalizeText(req.body.reason_text || req.body.reasonText);
    const preferredDate = normalizeText(req.body.preferred_date || req.body.preferredDate);
    const preferredTimeBlock = normalizeText(req.body.preferred_time_block || req.body.preferredTimeBlock);

    if (!area || !reasonCategory || !preferredDate || !preferredTimeBlock) {
      return res.status(400).json({
        success: false,
        message: 'Area, motivo, fecha preferida y bloque horario son obligatorios'
      });
    }

    const duplicate = await findActiveAppointmentByMatriculaAndArea(matricula, area);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: 'Ya tienes una cita activa para esta area',
        data: duplicate
      });
    }

    const { carnet, sessionEmail } = await loadStudentContext(matricula);
    const timestamp = nowIso();
    const appointment = {
      id: `appt_${crypto.randomUUID()}`,
      type: 'appointment',
      student: appointmentStudentFromCarnet(carnet),
      requested_by: {
        source: 'carnet_web',
        email_session: sessionEmail,
        role: 'student'
      },
      area,
      reason_category: reasonCategory,
      reason_text: reasonText,
      preferred_date: preferredDate,
      preferred_time_block: preferredTimeBlock,
      scheduled_start: null,
      scheduled_end: null,
      status: 'requested',
      priority: 'normal',
      assigned_to: null,
      created_at: timestamp,
      updated_at: timestamp,
      created_by: 'carnet_web',
      updated_by: null,
      cancellation_reason: null,
      reschedule_reason: null,
      source_referral_id: null,
      history: []
    };

    appendHistory(
      appointment,
      null,
      'requested',
      `student:${matricula}`,
      'student',
      reasonText || 'Solicitud creada desde Carnet Digital'
    );

    let created = await createAppointment(appointment);

    try {
      const emailResult = await sendAppointmentConfirmationEmail(created);
      const event = emailResult.success ? 'student_email_sent' : 'student_email_failed';
      const note = emailResult.success
        ? 'Correo de confirmacion enviado al estudiante'
        : `No se pudo enviar correo de confirmacion al estudiante: ${emailResult.reason || 'error SMTP'}`;
      appendSystemNotificationHistory(created, event, note);
      created = await replaceAppointment(created);
    } catch (emailError) {
      console.error('Error enviando correo de cita:', emailError.message);
      try {
        appendSystemNotificationHistory(
          created,
          'student_email_failed',
          'No se pudo enviar correo de confirmacion al estudiante'
        );
        created = await replaceAppointment(created);
      } catch (historyError) {
        console.error('Error registrando evento de correo:', historyError.message);
      }
    }

    res.status(201).json({ success: true, message: 'Solicitud de cita recibida', data: created });
  } catch (error) {
    console.error('Error creando appointment:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Error interno del servidor'
    });
  }
});

router.patch('/appointments/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const matricula = req.user && req.user.matricula;
    if (!matricula) {
      return res.status(400).json({ success: false, message: 'Matricula no encontrada en token' });
    }

    const appointment = await findAppointmentByIdForMatricula(req.params.id, matricula);
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Cita no encontrada' });
    }

    if (!CANCELABLE_STATUSES.includes(appointment.status)) {
      return res.status(409).json({
        success: false,
        message: 'Esta cita ya no puede cancelarse desde el Carnet Digital'
      });
    }

    const previousStatus = appointment.status;
    appointment.status = 'cancelled_by_student';
    appointment.cancellation_reason = normalizeText(req.body.cancellation_reason || req.body.reason);
    appointment.updated_at = nowIso();
    appointment.updated_by = `student:${matricula}`;
    appendHistory(
      appointment,
      previousStatus,
      appointment.status,
      `student:${matricula}`,
      'student',
      appointment.cancellation_reason || 'Cancelada por el alumno'
    );

    const updated = await replaceAppointment(appointment);
    res.json({ success: true, message: 'Cita cancelada', data: updated });
  } catch (error) {
    console.error('Error cancelando appointment:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

module.exports = router;
