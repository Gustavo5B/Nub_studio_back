import { countMunicipiosHidalgo } from "../services/municipiosService.js";

export const getMunicipiosHidalgo = async (req, res) => {
  try {
    const total = await countMunicipiosHidalgo();
    res.status(200).json({ ok: true, data: { total } });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Error al obtener municipios" });
  }
};
