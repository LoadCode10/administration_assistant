from sentence_transformers import SentenceTransformer, util

model = SentenceTransformer("BAAI/bge-m3")

a = model.encode("Comment créer une entreprise ?")
b = model.encode("démarrer une société")
c = model.encode("recette de tajine au poulet")
d = model.encode("كيفية إنشاء شركة أو مقاولة بالمغرب")

print("similar pair:", util.cos_sim(a,b))
print("unrelated pair", util.cos_sim(a,c))
print("similar pair:", util.cos_sim(a,d))
