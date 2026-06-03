import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';

export const crearDireccion = async (req, res) => {
    const db = pools[req.user?.rol] || pool;
    const id_usuario = req.user.id_usuario;
    const {
        calle,
        numero_exterior,
        numero_interior,
        colonia,
        id_municipio,
        id_estado,
        codigo_postal,
        referencias
    } = req.body;

    try {
        const result = await db.query(`
      INSERT INTO direcciones
        (id_usuario, calle, numero_exterior, numero_interior, colonia, id_municipio, id_estado, codigo_postal, referencias, tipo, fecha_creacion)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'envio', NOW())
      RETURNING id_direccion
    `, [id_usuario, calle, numero_exterior, numero_interior || null, colonia, id_municipio, id_estado, codigo_postal, referencias || null]);

        res.json({ success: true, id_direccion: result.rows[0].id_direccion });
    } catch (error) {
        logger.error('Error en crearDireccion:', error.message);
        res.status(500).json({ success: false, message: 'Error al guardar dirección' });
    }
};