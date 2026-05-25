import tensorflow as tf
import keras2onnx
import onnx

KERAS_PATH = r"C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\final_clcm_model.keras"
ONNX_PATH  = r"C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\final_clcm_model.onnx"

# Load model (compile=False helps avoid custom losses/metrics issues)
model = tf.keras.models.load_model(KERAS_PATH, compile=False)
print("Loaded model ✅")

# Convert
onnx_model = keras2onnx.convert_keras(model, model.name)
print("Converted to ONNX ✅")

# Save
onnx.save_model(onnx_model, ONNX_PATH)
print("Saved:", ONNX_PATH)