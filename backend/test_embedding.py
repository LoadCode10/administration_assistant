from sentence_transformers import SentenceTransformer, util

# print("Loading model (first run downloads ~2GB, be patient)...")
# model = SentenceTransformer("BAAI/bge-m3")
# print("Model loaded")

# text = "Comment créer une entreprise au Maroc ?"
# embedding = model.encode(text)
# print(f"Type: {type(embedding)}")
# print(f"Shape (dimension): {embedding.shape}")
# print(f"First 10 numbers: {embedding[:10]}")

model = SentenceTransformer("BAAI/bge-m3")

a = model.encode("Comment créer une entreprise ?")
b = model.encode("démarrer une société")
c = model.encode("recette de tajine au poulet")
d = model.encode("كيفية إنشاء شركة أو مقاولة بالمغرب")

print("similar pair:", util.cos_sim(a,b))
print("unrelated pair", util.cos_sim(a,c))
print("similar pair:", util.cos_sim(a,d))
