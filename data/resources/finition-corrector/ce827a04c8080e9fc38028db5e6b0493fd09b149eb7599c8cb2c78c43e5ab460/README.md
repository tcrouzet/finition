---
license: mit
language: fr
library_name: transformers
pipeline_tag: fill-mask
datasets:
  - uonlp/CulturaX
  - oscar
  - almanach/HALvest
  - wikimedia/wikipedia
tags:
  - roberta
  - camembert
---
# CamemBERT(a)-v2: A Smarter French Language Model Aged to Perfection

[CamemBERTv2](https://arxiv.org/abs/2411.08868) is a French language model pretrained on a large corpus of 275B tokens of French text. It is the second version of the CamemBERT model, which is based on the RoBERTa architecture. CamemBERTv2 is trained using the Masked Language Modeling (MLM) objective with 40% mask rate for 3 epochs on 32 H100 GPUs. The dataset used for training is a combination of French [OSCAR](https://oscar-project.org/) dumps from the [CulturaX Project](https://huggingface.co/datasets/uonlp/CulturaX), French scientific documents from [HALvest](https://huggingface.co/datasets/almanach/HALvest), and the French Wikipedia.

The model is a drop-in replacement for the original CamemBERT model. Note that the new tokenizer is different from the original CamemBERT tokenizer, so you will need to use Fast Tokenizers to use the model. It will work with `CamemBERTTokenizerFast` from `transformers` library even if the original `CamemBERTTokenizer` was sentencepiece-based.

**Check the CamemBERTav2 model, a much stronger French language model, based on DeBERTaV3, [here](https://huggingface.co/almanach/camembertav2-base).**

## Model update details
The new update includes:
- Much larger pretraining dataset: 275B unique tokens (previously ~32B)
- A newly built tokenizer based on WordPiece with 32,768 tokens, addition of the newline and tab characters, support emojis, and better handling of numbers (numbers are split into two digits tokens)
- Extended context window of 1024 tokens

More details are available in the [CamemBERTv2 paper](https://arxiv.org/abs/2411.08868).

## How to use
```python
from transformers import AutoTokenizer, AutoModel, AutoModelForMaskedLM

camembertv2 = AutoModelForMaskedLM.from_pretrained("almanach/camembertv2-base")
tokenizer = AutoTokenizer.from_pretrained("almanach/camembertv2-base")
```

## Fine-tuning Results:

Datasets: POS tagging and Dependency Parsing (GSD, Rhapsodie, Sequoia, FSMB), NER (FTB), the FLUE benchmark (XNLI, CLS, PAWS-X), the French Question Answering Dataset (FQuAD), Social Media NER (Counter-NER), and Medical NER (CAS1, CAS2, E3C, EMEA, MEDLINE).

| Model             | UPOS      | LAS       | FTB-NER   | CLS       | PAWS-X    | XNLI      | F1 (FQuAD) | EM (FQuAD) | Counter-NER | Medical-NER |
|-------------------|-----------|-----------|-----------|-----------|-----------|-----------|------------|------------|-------------|-------------|
| CamemBERT         | 97.59     | 88.69     | 89.97     | 94.62     | 91.36     | 81.95     | 80.98      | 62.51      | 84.18       | 70.96       |
| CamemBERTa        | 97.57     | 88.55     | 90.33     | 94.92     | 91.67     | 82.00     | 81.15      | 62.01      | 87.37       | 71.86       |
| CamemBERT-bio     | -         | -         | -         | -         | -         | -         | -          | -          | -           | 73.96       |
| **CamemBERTv2**   | 97.66     | 88.64     | 91.99     | 95.07     | 92.00     | 81.75     | 80.98      | 61.35      | 87.46       | 72.77       |
| CamemBERTav2      | 97.71     | 88.65     | 93.40     | 95.63     | 93.06     | 84.82     | 83.04      | 64.29      | 89.53       | 73.98       |

Finetuned models are available in the following collection: [CamemBERTv2 Finetuned Models](https://huggingface.co/collections/almanach/camembertv2-finetunes-67365f0b0c6b2cc06829cb3c)

## Pretraining Codebase

We use the pretraining codebase from the [CamemBERTa repository](https://github.com/WissamAntoun/camemberta) for all v2 models.


## Citation

```bibtex
@misc{antoun2024camembert20smarterfrench,
      title={CamemBERT 2.0: A Smarter French Language Model Aged to Perfection},
      author={Wissam Antoun and Francis Kulumba and Rian Touchent and Éric de la Clergerie and Benoît Sagot and Djamé Seddah},
      year={2024},
      eprint={2411.08868},
      archivePrefix={arXiv},
      primaryClass={cs.CL},
      url={https://arxiv.org/abs/2411.08868},
}
```
