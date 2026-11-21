"""
Training Script for Academic Subject Classification.
Trains Multinomial Naive Bayes and Logistic Regression models on TF-IDF features.
"""

import os
import joblib
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, classification_report

from preprocess import clean_text

def train_and_evaluate(dataset_path=None, models_dir=None):
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if dataset_path is None:
        dataset_path = os.path.join(base_dir, "dataset", "academic_subjects_dataset.csv")
    if models_dir is None:
        models_dir = os.path.join(base_dir, "models")

    os.makedirs(models_dir, exist_ok=True)

    print(f"[1/5] Loading academic dataset from: {dataset_path}")
    df = pd.read_csv(dataset_path)
    print(f"      Total samples: {len(df)} across {df['subject'].nunique()} distinct subjects.")

    print("[2/5] Cleaning and normalizing text excerpts...")
    df["clean_text"] = df["text"].apply(clean_text)

    X = df["clean_text"]
    y = df["subject"]

    # Stratified 80/20 train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )
    print(f"      Training set: {len(X_train)} samples | Testing set: {len(X_test)} samples.")

    # TF-IDF Feature Extraction (unigrams + bigrams, sublinear tf scaling)
    print("[3/5] Fitting TF-IDF Vectorizer (ngram_range=(1,2), max_features=3500)...")
    vectorizer = TfidfVectorizer(
        ngram_range=(1, 2),
        max_features=3500,
        sublinear_tf=True,
        min_df=2
    )
    X_train_vec = vectorizer.fit_transform(X_train)
    X_test_vec = vectorizer.transform(X_test)
    print(f"      Extracted vocabulary size: {len(vectorizer.vocabulary_)} features.")

    # Train Multinomial Naive Bayes
    print("\n[4/5] Training Model 1: Multinomial Naive Bayes (alpha=0.1)...")
    nb_model = MultinomialNB(alpha=0.1)
    nb_model.fit(X_train_vec, y_train)
    nb_preds = nb_model.predict(X_test_vec)
    nb_acc = accuracy_score(y_test, nb_preds)
    nb_f1 = f1_score(y_test, nb_preds, average="weighted")
    print(f"      Naive Bayes Test Accuracy: {nb_acc * 100:.2f}% | Weighted F1: {nb_f1:.4f}")

    # Train Logistic Regression
    print("\n[5/5] Training Model 2: Logistic Regression (C=1.0, max_iter=1000)...")
    lr_model = LogisticRegression(C=1.0, max_iter=1000, random_state=42)
    lr_model.fit(X_train_vec, y_train)
    lr_preds = lr_model.predict(X_test_vec)
    lr_acc = accuracy_score(y_test, lr_preds)
    lr_f1 = f1_score(y_test, lr_preds, average="weighted")
    print(f"      Logistic Regression Test Accuracy: {lr_acc * 100:.2f}% | Weighted F1: {lr_f1:.4f}")

    # Save artifacts
    print("\nSaving model artifacts to disk...")
    vec_path = os.path.join(models_dir, "tfidf_vectorizer.joblib")
    nb_path = os.path.join(models_dir, "nb_model.joblib")
    lr_path = os.path.join(models_dir, "lr_model.joblib")

    joblib.dump(vectorizer, vec_path)
    joblib.dump(nb_model, nb_path)
    joblib.dump(lr_model, lr_path)
    print(f"  ✔ Saved: {vec_path}")
    print(f"  ✔ Saved: {nb_path}")
    print(f"  ✔ Saved: {lr_path}")

    return {
        "vectorizer": vectorizer,
        "nb_model": nb_model,
        "lr_model": lr_model,
        "nb_metrics": {"accuracy": nb_acc, "f1": nb_f1},
        "lr_metrics": {"accuracy": lr_acc, "f1": lr_f1},
        "test_data": (X_test, y_test, X_test_vec)
    }

if __name__ == "__main__":
    train_and_evaluate()
