import io
import cv2
import numpy as np
from pdf2image import convert_from_bytes


def preprocess_image(image_bytes: bytes) -> bytes:
    """
    Preprocesa una imagen o documento PDF de comprobante fiscal:
    - Convierte la primera página de un PDF a imagen si se recibe un PDF.
    - Decodifica los bytes usando OpenCV y NumPy.
    - Convierte la imagen a escala de grises.
    - Aplica un filtro de realce de contraste adaptativo (CLAHE) para
      eliminar sombras y compensar baja iluminación en tickets y facturas.
    - Retorna los bytes de la imagen optimizada en formato JPEG.
    """
    if not image_bytes:
        raise ValueError("El archivo de entrada está vacío.")

    # Si el archivo es un PDF (identificado por sus magic bytes %PDF)
    if image_bytes.startswith(b"%PDF"):
        try:
            pages = convert_from_bytes(image_bytes, first_page=1, last_page=1, dpi=300)
            if not pages:
                raise ValueError("No se pudo extraer ninguna página del PDF.")
            # Convertir PIL Image a array de NumPy en escala de grises
            pil_image = pages[0].convert("RGB")
            np_image = np.array(pil_image)
            gray = cv2.cvtColor(np_image, cv2.COLOR_RGB2GRAY)
        except Exception as exc:
            raise ValueError(f"Error al procesar el archivo PDF con pdf2image: {exc}") from exc
    else:
        # Decodificar el buffer de bytes con OpenCV
        np_arr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if img is None:
            raise ValueError("No se pudo decodificar la imagen suministrada.")

        # Convertir a escala de grises
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Aplicar CLAHE (Contrast Limited Adaptive Histogram Equalization)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    # Codificar la imagen procesada en formato JPEG de alta calidad
    success, encoded_img = cv2.imencode(".jpg", enhanced, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    if not success:
        raise ValueError("Error al codificar la imagen preprocesada a formato JPEG.")

    return encoded_img.tobytes()

