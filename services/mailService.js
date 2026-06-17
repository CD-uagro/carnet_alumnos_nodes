const nodemailer = require('nodemailer');

function hasSmtpConfig() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.MAIL_FROM
  );
}

function createTransporter() {
  if (!hasSmtpConfig()) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function areaLabel(area) {
  const labels = {
    medicina: 'Medico',
    psicologia: 'Psicologia',
    nutricion: 'Nutricion',
    odontologia: 'Odontologia',
    atencion_estudiantil: 'Atencion estudiantil'
  };
  return labels[area] || String(area || '').replace(/_/g, ' ');
}

function timeBlockLabel(block) {
  const labels = {
    morning: 'Manana',
    afternoon: 'Tarde'
  };
  return labels[block] || String(block || '');
}

async function sendAppointmentConfirmationEmail(appointment) {
  const transporter = createTransporter();
  if (!transporter) {
    return {
      success: false,
      skipped: true,
      reason: 'SMTP no configurado'
    };
  }

  const student = appointment.student || {};
  const requestedBy = appointment.requested_by || {};
  const to = student.correo_institucional || requestedBy.email_session;

  if (!to) {
    return {
      success: false,
      skipped: true,
      reason: 'Correo del estudiante no disponible'
    };
  }

  const text = [
    'Hola, tu solicitud de atencion fue recibida correctamente.',
    '',
    `Area solicitada: ${areaLabel(appointment.area)}`,
    'Estado: Solicitud enviada',
    `Fecha preferida: ${appointment.preferred_date || 'Pendiente'}`,
    `Bloque: ${timeBlockLabel(appointment.preferred_time_block)}`,
    '',
    'El equipo SASU revisara tu solicitud y confirmara la atencion desde el sistema.',
    '',
    'Puedes consultar el estado actualizado desde tu Carnet Digital.',
    '',
    'Este correo es informativo. No respondas con datos medicos o personales sensibles por este medio.'
  ].join('\n');

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: 'Solicitud de atencion recibida - SASU',
    text
  });

  return { success: true, to };
}

module.exports = {
  sendAppointmentConfirmationEmail
};
