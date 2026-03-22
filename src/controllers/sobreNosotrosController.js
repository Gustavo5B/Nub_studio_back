import {
  getSobreNosotros,
  getTrayectoria,
  updateSobreNosotros,
  updateTrayectoria,
} from "../services/sobreNosotrosService.js";

export const getSobreNosotrosController = async (req, res) => {
  try {
    const data = await getSobreNosotros();
    res.status(200).json({ ok: true, data });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, message: "Error al obtener sobre nosotros" });
  }
};

export const getTrayectoriaController = async (req, res) => {
  try {
    const data = await getTrayectoria();
    res.status(200).json({ ok: true, data });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, message: "Error al obtener trayectoria" });
  }
};

export const updateSobreNosotrosController = async (req, res) => {
  try {
    const data = await updateSobreNosotros(req.body);
    res.status(200).json({ ok: true, data });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, message: "Error al actualizar sobre nosotros" });
  }
};

export const updateTrayectoriaController = async (req, res) => {
  try {
    await updateTrayectoria(req.body.items);
    res.status(200).json({ ok: true });
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, message: "Error al actualizar trayectoria" });
  }
};
