import tensorflow as tf

KERAS_PATH = r"C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\final_clcm_model.keras"
H5_PATH    = r"C:\Users\aliab\RP_Project\RP_PROJECT_IMPLEMENTATION_VS_CODE\fer-meet\fer-meet\final_clcm_model.h5"

model = tf.keras.models.load_model(KERAS_PATH, compile=False)
model.save(H5_PATH)
print("Saved:", H5_PATH)