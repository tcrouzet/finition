"""Entraînement indépendant et export du profil finition-electra-v1."""
import argparse
import hashlib
import json
from pathlib import Path

import torch
from safetensors.torch import save_file
from tokenizers import Tokenizer
from transformers import ElectraConfig, ElectraModel

HEADS = {"VirguleManquanteGeneraleDevant": 2, "MotsManquantsGeneralDevant": 125,
         "est": 12, "ou": 3, "ces": 5}


class Corrector(torch.nn.Module):
    def __init__(self):
        super().__init__()
        config = ElectraConfig(vocab_size=32005, embedding_size=128, hidden_size=256,
                               num_hidden_layers=6, num_attention_heads=4,
                               intermediate_size=1024, max_position_embeddings=512,
                               type_vocab_size=2, layer_norm_eps=1e-5, pad_token_id=1,
                               hidden_act="gelu", attn_implementation="eager")
        self.encoder = ElectraModel(config)
        self.heads = torch.nn.ModuleDict({name: torch.nn.Sequential(
            torch.nn.Linear(256, 128), torch.nn.ReLU(), torch.nn.Linear(128, 128),
            torch.nn.LayerNorm(128, eps=1e-5), torch.nn.ReLU(), torch.nn.Linear(128, size)
        ) for name, size in HEADS.items()})

    def forward(self, ids):
        hidden = self.encoder(input_ids=ids).last_hidden_state
        return {name: head(hidden) for name, head in self.heads.items()}


def read_labels(path):
    labels = json.loads(path.read_text())
    if set(labels) != set(HEADS):
        raise ValueError("Cinq listes de classes attendues")
    for name, size in HEADS.items():
        values = labels[name]
        if (not isinstance(values, list) or len(values) != size or values[0] != "O"
                or any(not isinstance(value, str) or not value for value in values)
                or len(set(values)) != size):
            raise ValueError(f"Classes invalides : {name}")
    if labels["VirguleManquanteGeneraleDevant"] != ["O", ","]:
        raise ValueError("Classes de virgule incompatibles")
    return labels


def read_examples(path):
    records = []
    seen = set()
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        ids, labels = record["input_ids"], record["labels"]
        if (not isinstance(ids, list) or not 3 <= len(ids) <= 130 or ids[0] != 5 or ids[-1] != 6
                or any(type(value) is not int or not 0 <= value < 32005 for value in ids)
                or set(labels) != set(HEADS)):
            raise ValueError("Séquence ou têtes invalides")
        for name, size in HEADS.items():
            target = labels[name]
            if (not isinstance(target, list) or len(target) != len(ids) or target[0] != -100
                    or target[-1] != -100 or not any(value != -100 for value in target)
                    or any(type(value) is not int or value != -100 and not 0 <= value < size for value in target)):
                raise ValueError(f"Annotations invalides : {name}")
        key = tuple(ids)
        if key in seen:
            raise ValueError("Séquence dupliquée dans le corpus")
        seen.add(key)
        records.append(record)
    if not records:
        raise ValueError("Corpus vide")
    return records


def read_tokenizer(path):
    data = Path(path).read_bytes()
    tokenizer = Tokenizer.from_str(data.decode())
    if (tokenizer.get_vocab_size() != 32005 or tokenizer.token_to_id("<unk>") != 3
            or tokenizer.token_to_id("<pad>") != 1 or tokenizer.token_to_id("<s>") != 5
            or tokenizer.token_to_id("</s>") != 6):
        raise ValueError("Vocabulaire ou identifiants spéciaux incompatibles")
    return data


def loss_for(model, record):
    device = next(model.parameters()).device
    outputs = model(torch.tensor([record["input_ids"]], device=device))
    return sum(torch.nn.functional.cross_entropy(outputs[name][0], torch.tensor(record["labels"][name], device=device),
                                                ignore_index=-100) for name in HEADS) / len(HEADS)


def export(model, tokenizer_path, labels, destination, name):
    destination = Path(destination)
    if destination.exists():
        raise ValueError("Le dossier de sortie existe déjà ; choisir un nouveau dossier")
    if not name.strip() or len(name) > 80:
        raise ValueError("Nom de modèle invalide")
    tokenizer_bytes = read_tokenizer(tokenizer_path)
    chunks = []
    offset = 0

    def array(tensor):
        nonlocal offset
        values = tensor.detach().cpu().float().contiguous().numpy().astype("<f4", copy=False)
        data = values.tobytes()
        spec = {"offset": offset, "dims": list(values.shape), "type": "f32"}
        chunks.append(data)
        offset += len(data)
        return spec

    def dense(module):
        return {"weight": array(module.weight), "bias": array(module.bias)}

    def norm(module):
        return {**dense(module), "epsilon": module.eps}

    def embedding(module):
        return {"weight": array(module.weight), "scale": 1, "zero": 0}

    base = model.encoder
    layers = []
    for layer in base.encoder.layer:
        attention = layer.attention
        layers.append({"query": dense(attention.self.query), "key": dense(attention.self.key),
                       "value": dense(attention.self.value), "attention": dense(attention.output.dense),
                       "attentionNorm": norm(attention.output.LayerNorm),
                       "intermediate": dense(layer.intermediate.dense), "output": dense(layer.output.dense),
                       "outputNorm": norm(layer.output.LayerNorm)})
    descriptor = {"version": 1, "kind": "electra", "hidden": 256, "heads": 4, "layers": layers,
                  "embeddings": {"word": embedding(base.embeddings.word_embeddings),
                                 "position": embedding(base.embeddings.position_embeddings),
                                 "token": embedding(base.embeddings.token_type_embeddings),
                                 "norm": norm(base.embeddings.LayerNorm)},
                  "projection": dense(base.embeddings_project),
                  "classifiers": {key: {"first": dense(head[0]), "second": dense(head[2]),
                                        "norm": norm(head[3]), "output": dense(head[5])}
                                  for key, head in model.heads.items()}}
    output = destination / "electra"
    output.mkdir(parents=True)
    (output / "model.json").write_text(json.dumps(descriptor) + "\n")
    (output / "weights.bin").write_bytes(b"".join(chunks))
    (output / "labels.json").write_text(json.dumps(labels, ensure_ascii=False) + "\n")
    (output / "tokenizer.json").write_bytes(tokenizer_bytes)
    files = []
    for file in sorted(output.iterdir()):
        data = file.read_bytes()
        files.append({"path": str(file.relative_to(destination)), "bytes": len(data),
                      "sha256": hashlib.sha256(data).hexdigest()})
    (destination / "pack.json").write_text(json.dumps({"version": 1, "architecture": "finition-electra-v1",
                                                     "name": name, "files": files}, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("train", "valid", "tokenizer", "labels", "output"):
        parser.add_argument("--" + arg, type=Path, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--epochs", type=int, default=3)
    args = parser.parse_args()
    if args.epochs < 1 or args.output.exists():
        parser.error("Époques positives et nouveau dossier de sortie requis")
    labels = read_labels(args.labels)
    read_tokenizer(args.tokenizer)
    train, valid = read_examples(args.train), read_examples(args.valid)
    if {tuple(row["input_ids"]) for row in train} & {tuple(row["input_ids"]) for row in valid}:
        parser.error("Une séquence apparaît dans entraînement et validation")
    torch.manual_seed(42)
    torch.set_num_threads(4)
    model = Corrector().to("cuda" if torch.cuda.is_available() else "cpu")
    optimizer = torch.optim.AdamW(model.parameters(), lr=5e-5)
    for epoch in range(args.epochs):
        model.train()
        for record in train:
            optimizer.zero_grad()
            loss = loss_for(model, record)
            if not torch.isfinite(loss):
                raise ValueError("Perte non finie")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
        model.eval()
        with torch.no_grad():
            validation = sum(loss_for(model, record).item() for record in valid) / len(valid)
        print(json.dumps({"epoch": epoch + 1, "validation_loss": validation}), flush=True)
    export(model, args.tokenizer, labels, args.output, args.name)
    save_file(model.state_dict(), str(args.output / "training.safetensors"))


if __name__ == "__main__":
    main()
