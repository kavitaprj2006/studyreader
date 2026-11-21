"""
Prediction Script & CLI for Academic Subject Classification.
Classifies text using either the serialized model artifacts or the lightweight JSON model bundle.
"""

import os
import sys
import json
import math
import argparse
from preprocess import clean_text

class SubjectPredictor:
    def __init__(self, bundle_path=None):
        if bundle_path is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            bundle_path = os.path.join(base_dir, "models", "model-bundle.json")

        with open(bundle_path, "r", encoding="utf-8") as f:
            self.bundle = json.load(f)

        self.classes = self.bundle["classes"]
        self.vocabulary = self.bundle["vocabulary"]
        self.idf = self.bundle["idf"]
        self.lr_coef = self.bundle["logistic_regression"]["coefficients"]
        self.lr_intercept = self.bundle["logistic_regression"]["intercept"]
        self.nb_prior = self.bundle["naive_bayes"]["class_log_prior"]
        self.nb_feat = self.bundle["naive_bayes"]["feature_log_prob"]
        self.confidence_threshold = self.bundle.get("confidence_threshold", 0.45)
        self.version = self.bundle.get("version", "1.0.0")

    def transform_tfidf(self, cleaned_text: str):
        """Computes sublinear TF-IDF vector with L2 normalization."""
        words = cleaned_text.split()
        if not words:
            return {}

        # 1. Unigrams and Bigrams count
        term_counts = {}
        for w in words:
            if w in self.vocabulary:
                idx = self.vocabulary[w]
                term_counts[idx] = term_counts.get(idx, 0) + 1

        for i in range(len(words) - 1):
            bg = f"{words[i]} {words[i+1]}"
            if bg in self.vocabulary:
                idx = self.vocabulary[bg]
                term_counts[idx] = term_counts.get(idx, 0) + 1

        if not term_counts:
            return {}

        # 2. Sublinear TF * IDF: (1 + ln(tf)) * idf
        tfidf_vec = {}
        norm_sq = 0.0
        for idx, count in term_counts.items():
            val = (1.0 + math.log(count)) * self.idf[idx]
            tfidf_vec[idx] = val
            norm_sq += val * val

        # 3. L2 Unit Normalization
        l2_norm = math.sqrt(norm_sq)
        if l2_norm > 0:
            for idx in tfidf_vec:
                tfidf_vec[idx] /= l2_norm

        return tfidf_vec

    def predict_logistic_regression(self, tfidf_vec: dict):
        """Calculates softmax probabilities using Logistic Regression weights."""
        if not tfidf_vec:
            uniform = 1.0 / len(self.classes)
            return {
                "predicted_subject": "General Studies",
                "confidence": uniform,
                "probabilities": {c: uniform for c in self.classes},
                "status": "unclassified"
            }

        logits = []
        for c_idx in range(len(self.classes)):
            z = self.lr_intercept[c_idx]
            weights = self.lr_coef[c_idx]
            for feat_idx, val in tfidf_vec.items():
                z += weights[feat_idx] * val
            logits.append(z)

        # Numerical stability for softmax
        max_logit = max(logits)
        exp_logits = [math.exp(z - max_logit) for z in logits]
        sum_exp = sum(exp_logits)
        probs = [e / sum_exp for e in exp_logits]

        best_idx = int(max(range(len(probs)), key=lambda i: probs[i]))
        best_prob = probs[best_idx]
        best_class = self.classes[best_idx]

        status = "classified" if best_prob >= self.confidence_threshold else "needs_review"

        return {
            "predicted_subject": best_class,
            "confidence": round(best_prob, 4),
            "status": status,
            "model_version": self.version,
            "probabilities": {
                self.classes[i]: round(probs[i], 4)
                for i in range(len(self.classes))
            }
        }

    def predict(self, text: str, algorithm="LogisticRegression"):
        cleaned = clean_text(text)
        tfidf_vec = self.transform_tfidf(cleaned)
        return self.predict_logistic_regression(tfidf_vec)

if __name__ == "__main__":
    predictor = SubjectPredictor()
    test_samples = [
        "Database normalization 3NF Boyce Codd normal form ACID transactions SQL query optimization",
        "Newton's laws of motion acceleration kinetic energy gravitation friction torque",
        "Photosynthesis Calvin cycle chloroplast ATP synthesis cellular respiration mitochondria",
        "Binary search tree AVL rotations Dijkstra shortest path algorithm time complexity O(n log n)"
    ]

    print(f"Loaded StudyReader Subject Classifier v{predictor.version} (Classes: {len(predictor.classes)})")
    print("-" * 75)
    for sample in test_samples:
        result = predictor.predict(sample)
        print(f"Text: '{sample[:60]}...'")
        print(f" -> Predicted: {result['predicted_subject']} (Confidence: {result['confidence']*100:.2f}%, Status: {result['status']})")
        print()
