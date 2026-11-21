"""
Evaluation Script for Academic Subject Classification.
Generates comprehensive evaluation metrics, confusion matrix, and comparative performance report.
"""

import os
import joblib
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    classification_report, confusion_matrix
)

from preprocess import clean_text

def run_evaluation():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dataset_path = os.path.join(base_dir, "dataset", "academic_subjects_dataset.csv")
    models_dir = os.path.join(base_dir, "models")

    vec_path = os.path.join(models_dir, "tfidf_vectorizer.joblib")
    nb_path = os.path.join(models_dir, "nb_model.joblib")
    lr_path = os.path.join(models_dir, "lr_model.joblib")

    print("[1/4] Loading dataset and model artifacts...")
    df = pd.read_csv(dataset_path)
    df["clean_text"] = df["text"].apply(clean_text)

    X = df["clean_text"]
    y = df["subject"]

    # Replicate test split with exact seed
    _, X_test, _, y_test = train_test_split(X, y, test_size=0.20, random_state=42, stratify=y)

    vectorizer = joblib.load(vec_path)
    nb_model = joblib.load(nb_path)
    lr_model = joblib.load(lr_path)

    X_test_vec = vectorizer.transform(X_test)
    classes = list(nb_model.classes_)

    print("\n" + "=" * 70)
    print("MODEL COMPARISON & EVALUATION BENCHMARK")
    print("=" * 70)

    # Evaluate Naive Bayes
    nb_preds = nb_model.predict(X_test_vec)
    nb_acc = accuracy_score(y_test, nb_preds)
    nb_prec = precision_score(y_test, nb_preds, average="weighted", zero_division=0)
    nb_rec = recall_score(y_test, nb_preds, average="weighted", zero_division=0)
    nb_f1 = f1_score(y_test, nb_preds, average="weighted", zero_division=0)

    # Evaluate Logistic Regression
    lr_preds = lr_model.predict(X_test_vec)
    lr_acc = accuracy_score(y_test, lr_preds)
    lr_prec = precision_score(y_test, lr_preds, average="weighted", zero_division=0)
    lr_rec = recall_score(y_test, lr_preds, average="weighted", zero_division=0)
    lr_f1 = f1_score(y_test, lr_preds, average="weighted", zero_division=0)

    print(f"\n{'Metric':<25} | {'Multinomial Naive Bayes':<22} | {'Logistic Regression':<22}")
    print("-" * 75)
    print(f"{'Accuracy':<25} | {nb_acc * 100:>20.2f}% | {lr_acc * 100:>20.2f}%")
    print(f"{'Precision (Weighted)':<25} | {nb_prec:>21.4f} | {lr_prec:>21.4f}")
    print(f"{'Recall (Weighted)':<25} | {nb_rec:>21.4f} | {lr_rec:>21.4f}")
    print(f"{'F1-Score (Weighted)':<25} | {nb_f1:>21.4f} | {lr_f1:>21.4f}")
    print("-" * 75)

    print("\n" + "=" * 70)
    print("DETAILED CLASSIFICATION REPORT (Logistic Regression)")
    print("=" * 70)
    print(classification_report(y_test, lr_preds, zero_division=0))

    cm = confusion_matrix(y_test, lr_preds, labels=classes)
    cm_df = pd.DataFrame(cm, index=classes, columns=classes)
    print("Confusion Matrix diagonal (correct predictions per class):")
    for cls in classes:
        correct = cm_df.loc[cls, cls]
        total = cm_df.loc[cls].sum()
        print(f"  - {cls:<32}: {correct}/{total} ({correct/total*100:.1f}%)")

    # Export metrics JSON artifact
    import json
    import shutil
    from datetime import datetime, timezone

    clf_dict = classification_report(y_test, lr_preds, output_dict=True, zero_division=0)
    per_subject = {}
    for cls in classes:
        if cls in clf_dict:
            per_subject[cls] = {
                "precision": round(clf_dict[cls]["precision"], 4),
                "recall": round(clf_dict[cls]["recall"], 4),
                "f1_score": round(clf_dict[cls]["f1-score"], 4),
                "support": int(clf_dict[cls]["support"])
            }

    metrics_bundle = {
        "format": "studyreader-ml-eval",
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "dataset_size": len(df),
        "test_size": len(X_test),
        "train_size": len(df) - len(X_test),
        "classes_count": len(classes),
        "classes": classes,
        "models_comparison": {
            "multinomial_naive_bayes": {
                "accuracy": round(nb_acc, 4),
                "precision": round(nb_prec, 4),
                "recall": round(nb_rec, 4),
                "f1_score": round(nb_f1, 4)
            },
            "logistic_regression": {
                "accuracy": round(lr_acc, 4),
                "precision": round(lr_prec, 4),
                "recall": round(lr_rec, 4),
                "f1_score": round(lr_f1, 4)
            }
        },
        "per_subject": per_subject,
        "confusion_matrix": {
            "classes": classes,
            "matrix": cm.tolist()
        }
    }

    metrics_out = os.path.join(models_dir, "evaluation-metrics.json")
    with open(metrics_out, "w", encoding="utf-8") as f:
        json.dump(metrics_bundle, f, indent=2)
    print(f"\n[Artifact] Saved evaluation metrics to: {metrics_out}")

    backend_dest = os.path.join(base_dir, "..", "..", "backend", "services", "ml", "evaluation-metrics.json")
    backend_dest = os.path.abspath(backend_dest)
    shutil.copyfile(metrics_out, backend_dest)
    print(f"[Artifact] Synchronized to backend runtime: {backend_dest}")

if __name__ == "__main__":
    run_evaluation()
