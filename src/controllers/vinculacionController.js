import { pool } from '../config/db.js';
import logger from '../config/logger.js';

export const generarCodigo = async (req, res) => {
    try {
        const usuarioId = req.user.id_usuario;

        await pool.query(
            'UPDATE codigos_vinculacion SET usado = TRUE WHERE usuario_id = $1 AND usado = FALSE',
            [usuarioId]
        );

        const codigo = String(Math.floor(1000 + Math.random() * 9000));
        const expiraEn = new Date(Date.now() + 10 * 60 * 1000);

        await pool.query(
            'INSERT INTO codigos_vinculacion (usuario_id, codigo, expira_en) VALUES ($1, $2, $3)',
            [usuarioId, codigo, expiraEn]
        );

        logger.info(`Código de vinculación generado para usuario ${usuarioId}`);
        return res.status(201).json({ codigo, expira_en: expiraEn });
    } catch (error) {
        logger.error(`Error generando código de vinculación: ${error.message}`);
        return res.status(500).json({ message: 'Error al generar el código', code: 'LINK_CODE_ERROR' });
    }
};

export const vincularCuenta = async (req, res) => {
    try {
        const { codigo, alexa_user_id } = req.body;

        if (!codigo || !/^\d{4}$/.test(codigo) || !alexa_user_id) {
            return res.status(400).json({ message: 'Código o alexa_user_id inválido', code: 'INVALID_INPUT' });
        }

        const resultCodigo = await pool.query(
            `SELECT usuario_id FROM codigos_vinculacion
             WHERE codigo = $1 AND usado = FALSE AND expira_en > NOW()
             ORDER BY created_at DESC LIMIT 1`,
            [codigo]
        );

        if (resultCodigo.rows.length === 0) {
            logger.warn(`Intento de vinculación con código inválido/expirado: ${codigo}`);
            return res.status(404).json({ message: 'Código inválido o expirado', code: 'CODE_NOT_FOUND' });
        }

        const usuarioId = resultCodigo.rows[0].usuario_id;

        await pool.query(
            'UPDATE codigos_vinculacion SET usado = TRUE WHERE codigo = $1 AND usuario_id = $2',
            [codigo, usuarioId]
        );

        await pool.query(
            `INSERT INTO vinculaciones (alexa_user_id, usuario_id)
             VALUES ($1, $2)
             ON CONFLICT (alexa_user_id)
             DO UPDATE SET usuario_id = EXCLUDED.usuario_id`,
            [alexa_user_id, usuarioId]
        );

        const resultUsuario = await pool.query(
            'SELECT nombre_completo FROM usuarios WHERE id_usuario = $1',
            [usuarioId]
        );

        logger.info(`Vinculación exitosa: alexa_user_id ${alexa_user_id} -> usuario ${usuarioId}`);
        return res.status(200).json({
            usuario_id: usuarioId,
            nombre: resultUsuario.rows[0] ? resultUsuario.rows[0].nombre_completo : null
        });

    } catch (error) {
        logger.error(`Error en vincularCuenta: ${error.message}`);
        return res.status(500).json({ message: 'Error al vincular la cuenta', code: 'LINK_ERROR' });
    }
};

export const consultarVinculacion = async (req, res) => {
    try {
        const { alexaUserId } = req.params;

        const result = await pool.query(
            `SELECT v.usuario_id, u.nombre_completo
             FROM vinculaciones v
             JOIN usuarios u ON u.id_usuario = v.usuario_id
             WHERE v.alexa_user_id = $1`,
            [alexaUserId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No vinculado', code: 'NOT_LINKED' });
        }

        return res.status(200).json({
            usuario_id: result.rows[0].usuario_id,
            nombre: result.rows[0].nombre_completo
        });

    } catch (error) {
        logger.error(`Error en consultarVinculacion: ${error.message}`);
        return res.status(500).json({ message: 'Error al consultar vinculación', code: 'QUERY_ERROR' });
    }
};