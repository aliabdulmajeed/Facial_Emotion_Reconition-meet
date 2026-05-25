import os, shutil
from keras import models

KERAS_PATH = r"C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\final_clcm_model.keras"
OUT_DIR = r"C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\savedmodel_clcm"

model = models.load_model(KERAS_PATH, compile=False)
print("Loaded .keras ✅")

if os.path.exists(OUT_DIR):
    shutil.rmtree(OUT_DIR)

model.export(OUT_DIR)
print("Exported SavedModel ✅:", OUT_DIR)