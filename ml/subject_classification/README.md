# StudyReader — Smart Academic Subject Classifier (Machine Learning Module)

> **Internship Project:** Machine Learning-Based Automatic Academic Subject Classification  
> **Platform:** StudyReader — Cloud-Based AI-Powered Academic Learning Platform  
> **Module Version:** 1.0.0  
> **Frameworks:** Python (Scikit-Learn, Pandas, NumPy, Joblib) + Pure JavaScript Node.js Runtime Engine  

---

## 1. Project Motivation & Problem Statement

StudyReader is an educational learning platform used by school students (Classes 9–12), undergraduate college students (Computer Science, Engineering, Humanities, Commerce), and teachers. Previously, uploaded documents (PDFs, PPTXs, DOCX) required manual subject tagging or were left unorganized.

### Key Objectives
1. **Genuine Traditional Supervised Machine Learning**: Implement a standalone classification pipeline based on TF-IDF feature extraction, Multinomial Naive Bayes, and Logistic Regression. **No Large Language Model (LLM) is used for classification**, eliminating token costs, latency, and hallucination.
2. **Dynamic & Institution-Independent**: Academic subject catalogs vary across universities, semesters, and boards. The ML engine predicts a canonical academic subject and dynamically links it to the user's active subject catalog via alias and semantic substring matching.
3. **Strict Production Isolation**: Document upload, Supabase storage, Gemini 768-dim embeddings, vector search, and RAG chat remain completely isolated. The ML classifier runs as a non-blocking hook that never impedes document processing.
4. **Zero-Dependency Lightweight Deployment**: In serverless production environments (Vercel), heavy Python wheels (>100MB) can exceed bundle limits. The trained model parameters and vocabulary are exported to `model-bundle.json` (981 KB), enabling ultra-fast (<2ms) pure JavaScript inference without spawning external processes.

---

## 2. Mathematical Foundations

### 2.1 Term Frequency - Inverse Document Frequency (TF-IDF)
For a term $t$ in document $d$ within a corpus $D$ of size $N$:

$$\text{TF}(t, d) = 1 + \ln(\text{count}(t, d)) \quad \text{for } \text{count}(t, d) > 0$$

$$\text{IDF}(t, D) = \ln\left(\frac{1 + N}{1 + \text{DF}(t)}\right) + 1$$

$$\text{TF-IDF}(t, d) = \text{TF}(t, d) \times \text{IDF}(t, D)$$

Vectors are then normalized using the $L_2$ Euclidean norm:

$$\vec{v}_{\text{norm}} = \frac{\vec{v}}{\|\vec{v}\|_2} = \frac{\vec{v}}{\sqrt{\sum_{i} v_i^2}}$$

### 2.2 Multinomial Naive Bayes
Applies Bayes' Theorem assuming conditional feature independence given class $c \in C$:

$$P(c \mid \vec{x}) \propto P(c) \prod_{i=1}^{V} P(w_i \mid c)^{x_i}$$

In log-space to prevent underflow:

$$\ln P(c \mid \vec{x}) = \ln P(c) + \sum_{i=1}^{V} x_i \ln P(w_i \mid c)$$

With Laplace smoothing ($\alpha = 0.1$):

$$P(w_i \mid c) = \frac{N_{ci} + \alpha}{N_c + \alpha \cdot V}$$

### 2.3 Logistic Regression (Softmax Regression)
Models class probabilities via a linear combination of features passed through the Softmax function:

$$z_c = \beta_{0, c} + \sum_{j=1}^{M} \beta_{j, c} x_j$$

$$P(Y = c \mid \vec{x}) = \frac{e^{z_c - \max_k(z_k)}}{\sum_{k=1}^{|C|} e^{z_k - \max_k(z_k)}}$$

Parameters are optimized by minimizing the Cross-Entropy loss with $L_2$ Ridge regularization.

---

## 3. Dataset Architecture

The dataset (`academic_subjects_dataset.csv`) contains **750 balanced samples** across **15 distinct academic subjects**:

| Category | Subject Name | Educational Level | Core Concepts & Terminology |
|---|---|---|---|
| STEM (School) | **Mathematics** | School | Calculus, integration, limits, linear algebra, matrices, probability |
| STEM (School) | **Physics** | School | Kinematics, thermodynamics, wave optics, electromagnetism, Newton's laws |
| STEM (School) | **Chemistry** | School | Organic reactions, SN1/SN2, periodic table, electrochemistry, hybridization |
| STEM (School) | **Biology** | School | Cell division, genetics, DNA replication, photosynthesis, human anatomy |
| Humanities | **English Literature** | School | Shakespearean tragedy, soliloquy, poetic meter, grammar, rhetoric |
| Humanities | **History & Civics** | School | Indian freedom struggle, French revolution, Constitution, parliament |
| Humanities | **Economics** | School | Microeconomics, GDP, inflation, monetary policy, supply & demand |
| STEM (College) | **Data Structures & Algorithms** | College | Binary search trees, AVL rotations, Dijkstra, Dynamic Programming, sorting |
| STEM (College) | **Database Management Systems** | College | Relational schema, SQL, 3NF/BCNF normalization, ACID transactions, B+ trees |
| STEM (College) | **Operating Systems** | College | CPU scheduling, semaphores, deadlocks, virtual memory paging, inodes |
| STEM (College) | **Computer Networks** | College | OSI model, TCP 3-way handshake, CIDR subnetting, OSPF/BGP routing, DNS |
| STEM (College) | **Software Engineering** | College | Agile Scrum, SOLID principles, design patterns, UML diagrams, CI/CD |
| STEM (College) | **Machine Learning & AI** | College | Supervised learning, gradient descent, SVM, cross-entropy, neural networks |
| STEM (College) | **Cloud Computing & DevOps** | College | Docker containers, Kubernetes, AWS S3/EC2, serverless, microservices |
| STEM (College) | **Discrete Mathematics** | College | Propositional logic, set theory, graph theory, induction, combinatorics |

---

## 4. Model Evaluation & Benchmark Results

Evaluated on an independent stratified 20% test split ($N = 150$ test samples, 10 per class):

| Metric | Multinomial Naive Bayes ($\alpha=0.1$) | Logistic Regression ($C=1.0$) |
|---|---|---|
| **Overall Accuracy** | **98.00%** | **99.33%** |
| **Weighted Precision** | **0.9818** | **0.9939** |
| **Weighted Recall** | **0.9800** | **0.9933** |
| **Weighted F1-Score** | **0.9799** | **0.9933** |

### Per-Class Test Performance (Logistic Regression)
- 14 out of 15 classes achieved **100% Precision and 100% Recall**.
- Average inference time: **< 2 milliseconds** per document.

---

## 5. Directory Structure

```text
studyreader/
├── backend/
│   ├── services/
│   │   ├── ml/
│   │   │   ├── model-bundle.json       # Exported lightweight zero-dependency JSON model
│   │   │   └── subject-classifier.js   # Pure JavaScript Node.js inference engine
│   │   └── queue/
│   │       └── job-processor.js        # Non-blocking background extraction hook
│   └── tests/
│       └── test_smart_academic_classifier.js  # Node.js automated test suite
├── database/
│   └── migrations/
│       └── 007_smart_academic_classifier.sql  # Schema migration (subjects & pdfs)
└── ml/
    └── subject_classification/
        ├── dataset/
        │   ├── dataset_generator.py           # Synthetic academic corpus generator
        │   └── academic_subjects_dataset.csv  # 750 labeled samples
        ├── models/
        │   ├── model-bundle.json              # Primary inference artifact
        │   ├── nb_model.joblib                # Serialized Naive Bayes
        │   ├── lr_model.joblib                # Serialized Logistic Regression
        │   └── tfidf_vectorizer.joblib        # Fitted Scikit-Learn vectorizer
        ├── notebooks/
        │   └── subject_classifier_experiment.ipynb  # Interactive experiment notebook
        ├── src/
        │   ├── preprocess.py                  # Text cleaning & stopword removal
        │   ├── train.py                       # Training pipeline
        │   ├── evaluate.py                    # Benchmark & evaluation reports
        │   ├── export_model.py                # Zero-dependency bundle exporter
        │   └── predict.py                     # CLI predictor
        └── tests/
            └── test_classifier.py             # Python unit test suite
```

---

## 6. How to Run & Verify

### 1. Run Python Unit Tests
```bash
python ml/subject_classification/tests/test_classifier.py
```

### 2. Run Evaluation & Benchmark Report
```bash
python ml/subject_classification/src/evaluate.py
```

### 3. Test Prediction CLI
```bash
python ml/subject_classification/src/predict.py
```

### 4. Run Node.js Production Engine Tests
```bash
cd backend
node tests/test_smart_academic_classifier.js
```

---

## 7. Dynamic Catalog Matching & Confidence Thresholding

1. When a PDF is processed, the classifier extracts the first 12,000 characters (covering the syllabus, course objectives, chapter heading, or exam questions).
2. The model outputs a predicted class and probability confidence score.
3. The catalog resolver searches the user's active classroom subjects or personal subjects:
   - Direct match or alias match (e.g., `"Operating Systems"` matches `"OS"`, `"OS Lab"`, or code `"CS204"`).
   - If confidence $\ge \tau$ ($0.35$ calibrated for 15 classes where random chance is $0.067$), the document is automatically assigned (`classification_status = 'classified'`, `classification_source = 'ml_auto'`).
   - If the subject is not yet created in the user's catalog or confidence is low, it marks `classification_status = 'needs_review'`.
4. Users and teachers can reclassify or assign subjects anytime using the library UI or `PATCH /api/pdfs/:id/subject`.
