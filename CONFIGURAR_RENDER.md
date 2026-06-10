# 🚀 Configurar Variables de Entorno en Render

## ✅ Cambios Realizados

El backend ahora está integrado con Azure Cosmos DB para leer las promociones del contenedor `promociones_salud`.

### Archivos Modificados:
1. **config/database.js** - Agregado soporte para contenedor de promociones
2. **routes/promociones.js** - Actualizado para leer de Cosmos DB en lugar de datos en memoria
3. **.env.example** - Agregada variable `COSMOS_CONTAINER_PROMOCIONES`

---

## 📋 Pasos para Configurar en Render

### 1. Entrar al Dashboard de Render
1. Ve a [https://dashboard.render.com](https://dashboard.render.com)
2. Inicia sesión con tu cuenta
3. Busca tu servicio: **carnet-alumnos-nodes**

### 2. Agregar Variable de Entorno para Promociones

En el panel de tu servicio:

1. Ve a la sección **"Environment"** en el menú lateral
2. Busca la variable `COSMOS_CONTAINER_PROMOCIONES` (si no existe, agrégala)
3. Configura con el valor: `promociones_salud`

### 3. Verificar Otras Variables de Cosmos DB

Asegúrate de que estas variables ya estén configuradas correctamente:

```
COSMOS_ENDPOINT=https://sasuuagro.documents.azure.com:443/
COSMOS_KEY=<tu_clave_de_cosmos_db>
COSMOS_DATABASE=SASU
COSMOS_CONTAINER_CARNETS=carnets_id
COSMOS_CONTAINER_CITAS=cita_id
COSMOS_CONTAINER_PROMOCIONES=promociones_salud
```

### 4. Agregar Variables de Azure Blob Storage para Fotografias

En **Environment** del servicio `carnet-alumnos-nodes`, agregar:

```
AZURE_STORAGE_CONNECTION_STRING=<connection_string_de_sasufotos>
AZURE_STORAGE_CONTAINER_FOTOS=fotos-carnet
```

Importante: no guardar `AZURE_STORAGE_CONNECTION_STRING` en GitHub, logs ni capturas.

### 5. Verificar Variables de JWT y CORS

```
JWT_SECRET=<tu_jwt_secret>
JWT_EXPIRES_IN=7d
NODE_ENV=production
CORS_ORIGINS=http://localhost:3000,https://carnet-alumnos-nodes.onrender.com,https://app.carnetdigital.space
```

---

## 🔄 Despliegue Automático

Una vez que hayas configurado la variable de entorno:

1. Render detectará los cambios en el repositorio (el push que acabamos de hacer)
2. Iniciará un nuevo despliegue automáticamente
3. El despliegue tomará aproximadamente 2-3 minutos

### Ver el Estado del Despliegue:

1. Ve a la pestaña **"Logs"** en tu servicio de Render
2. Verás el progreso del despliegue en tiempo real
3. Busca estos mensajes para confirmar que todo está bien:
   ```
   ✅ Conexión a Azure Cosmos DB establecida
   📦 Contenedor carnets: carnets_id
   📦 Contenedor citas: cita_id
   📦 Contenedor promociones: promociones_salud
   🚀 Servidor corriendo en puerto 3000
   ```

---

## 🧪 Probar el Endpoint

Una vez desplegado, puedes probar el endpoint de promociones:

### Endpoint:
```
GET https://carnet-alumnos-nodes.onrender.com/promociones/activas
```

### Headers requeridos:
```
Authorization: Bearer <tu_token_jwt>
```

### Respuesta esperada:
```json
{
  "success": true,
  "data": [
    {
      "id": "promocion:uuid-aqui",
      "link": "https://url-de-la-promocion.com",
      "departamento": "SALUD",
      "categoria": "vacunacion",
      "programa": "Campaña de Vacunación",
      "matricula": "15662",
      "destinatario": "alumno",
      "autorizado": true,
      "createdAt": "2025-01-15T10:30:00Z",
      "createdBy": "admin@uagro.mx"
    }
  ],
  "count": 1
}
```

---

## 📊 Lógica de Filtrado

El endpoint `/promociones/activas` retorna promociones que:
- ✅ Están autorizadas (`autorizado = true`)
- ✅ Son para la matrícula específica del usuario (`matricula = "15662"`)
- ✅ O son para todos los alumnos (`matricula = null` o no definida)

---

## 🐛 Solución de Problemas

### Si el despliegue falla:
1. Verifica los logs en Render
2. Asegúrate de que todas las variables de entorno estén configuradas
3. Verifica que la clave de Cosmos DB sea correcta

### Si no aparecen promociones:
1. Verifica que el contenedor `promociones_salud` exista en Cosmos DB
2. Verifica que haya documentos con `autorizado = true`
3. Verifica que el campo `matricula` esté correcto o sea `null`

### Si hay error de autenticación:
1. Verifica que el token JWT sea válido
2. Verifica que `JWT_SECRET` en Render coincida con el usado para generar el token

---

## ✅ Checklist Final

- [ ] Variable `COSMOS_CONTAINER_PROMOCIONES` agregada en Render
- [ ] Todas las variables de Cosmos DB configuradas correctamente
- [ ] Push realizado a GitHub (ya hecho ✅)
- [ ] Despliegue automático en Render completado
- [ ] Logs muestran conexión exitosa a los 3 contenedores
- [ ] Endpoint `/promociones/activas` responde correctamente
- [ ] Flutter app muestra las promociones

---

## 🎉 ¡Listo!

Tu backend ahora está completamente integrado con Azure Cosmos DB y leerá las promociones reales del contenedor `promociones_salud`.

Las promociones se crean desde tu aplicación de administración y automáticamente aparecerán en la app de carnets cuando los usuarios las consulten.
