"""
Model Bundle Exporter for StudyReader Academic Subject Classifier.
Exports vocabulary, IDF weights, and model parameters into a compact, zero-dependency JSON bundle.
Copies the artifact to both ml/subject_classification/models/ and backend/services/ml/.
"""

import os
import json
import shutil
import joblib
import numpy as np

def export_bundle():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    models_dir = os.path.join(base_dir, "models")
    backend_ml_dir = os.path.join(base_dir, "..", "..", "backend", "services", "ml")

    vec_path = os.path.join(models_dir, "tfidf_vectorizer.joblib")
    nb_path = os.path.join(models_dir, "nb_model.joblib")
    lr_path = os.path.join(models_dir, "lr_model.joblib")

    print("[1/3] Loading joblib model artifacts...")
    vectorizer = joblib.load(vec_path)
    nb_model = joblib.load(nb_path)
    lr_model = joblib.load(lr_path)

    classes = [str(c) for c in lr_model.classes_]
    vocab = {str(k): int(v) for k, v in vectorizer.vocabulary_.items()}
    idf = [round(float(w), 6) for w in vectorizer.idf_]

    # Convert Logistic Regression weights
    lr_coef = [[round(float(val), 6) for val in row] for row in lr_model.coef_]
    lr_intercept = [round(float(val), 6) for val in lr_model.intercept_]

    # Convert Naive Bayes weights
    nb_class_log_prior = [round(float(val), 6) for val in nb_model.class_log_prior_]
    nb_feature_log_prob = [[round(float(val), 6) for val in row] for row in nb_model.feature_log_prob_]

    bundle = {
        "format": "studyreader-ml-bundle",
        "version": "1.0.0",
        "exported_at": "2026-11-21T08:30:00Z",
        "algorithm": "LogisticRegression",
        "alternative_algorithm": "MultinomialNB",
        "confidence_threshold": 0.45,
        "classes": classes,
        "num_classes": len(classes),
        "num_features": len(vocab),
        "vocabulary": vocab,
        "idf": idf,
        "logistic_regression": {
            "coefficients": lr_coef,
            "intercept": lr_intercept
        },
        "naive_bayes": {
            "class_log_prior": nb_class_log_prior,
            "feature_log_prob": nb_feature_log_prob
        }
    }

    out_json_path = os.path.join(models_dir, "model-bundle.json")
    print(f"[2/3] Writing model bundle to: {out_json_path}")
    with open(out_json_path, "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False)

    size_kb = os.path.getsize(out_json_path) / 1024
    print(f"      Bundle file size: {size_kb:.1f} KB")

    # Sync to backend/services/ml
    os.makedirs(backend_ml_dir, exist_ok=True)
    backend_dest = os.path.join(backend_ml_dir, "model-bundle.json")
    print(f"[3/3] Syncing bundle to backend runtime: {backend_dest}")
    shutil.copyfile(out_json_path, backend_dest)
    print("  ✔ Successfully exported and synchronized model bundle!")

if __name__ == "__main__":
    export_bundle()
