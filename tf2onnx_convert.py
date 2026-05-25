import os
import tensorflow as tf

KERAS_PATH = r"C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\final_clcm_model.keras"
SAVEDMODEL_DIR = r".\_savedmodel_tmp"
ONNX_OUT = r".\final_clcm_model.onnx"

model = tf.keras.models.load_model(KERAS_PATH, compile=False)
print("Loaded ✅")

# Export SavedModel (TF2.10 supports this)
if os.path.exists(SAVEDMODEL_DIR):
    import shutil
    shutil.rmtree(SAVEDMODEL_DIR)

tf.saved_model.save(model, SAVEDMODEL_DIR)
print("SavedModel ✅")

# Convert SavedModel -> ONNX
cmd = f'python -m tf2onnx.convert --saved-model "{SAVEDMODEL_DIR}" --output "{ONNX_OUT}" --opset 13'
print("Running:", cmd)
code = os.system(cmd)
if code != 0:
    raise SystemExit("❌ Conversion failed")
print("✅ ONNX written:", ONNX_OUT)