"""Vérifie un pas d'entraînement, les annotations et un export indépendant."""
import json
import sys
from pathlib import Path

import torch
from train import Corrector, HEADS, export, loss_for, read_examples, read_labels


def main():
    tokenizer, labels_path, destination = map(Path, sys.argv[1:])
    labels = read_labels(labels_path)
    torch.manual_seed(7)
    torch.set_num_threads(4)
    model = Corrector()
    record = {"input_ids": [5, 100, 200, 6],
              "labels": {name: [-100, 0, 1, -100] for name in HEADS}}
    optimizer = torch.optim.AdamW(model.parameters(), lr=5e-5)
    loss = loss_for(model, record)
    assert torch.isfinite(loss)
    before = model.heads["ou"][5].weight.detach().clone()
    loss.backward()
    optimizer.step()
    assert not torch.equal(before, model.heads["ou"][5].weight)
    model.eval()
    export(model, tokenizer, labels, destination, "Test indépendant")
    with torch.no_grad():
        outputs = model(torch.tensor([record["input_ids"]]))
    reference = {"ids": record["input_ids"], "scores": {name: value.flatten().tolist() for name, value in outputs.items()}}
    (destination / "reference.json").write_text(json.dumps(reference))
    dataset = destination / "sample.jsonl"
    dataset.write_text(json.dumps(record) + "\n")
    assert read_examples(dataset) == [record]
    for invalid in [[], [record, record], [{**record, "input_ids": [5, -1, 200, 6]}],
                    [{**record, "labels": {name: [-100] * 4 for name in HEADS}}]]:
        dataset.write_text("\n".join(map(json.dumps, invalid)))
        try:
            read_examples(dataset)
        except ValueError:
            continue
        raise AssertionError("Corpus invalide accepté")
    print("PASS: pas d'entraînement, validation des corpus, export float32 et référence PyTorch")


if __name__ == "__main__":
    main()
