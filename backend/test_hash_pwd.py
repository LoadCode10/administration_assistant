from auth import hash_password, verify_password, create_acces_token, decode_acces_token

# correct_pwd = "mehdi12345"
# hashed_pwd = hash_password(correct_pwd)
# print (hashed_pwd)
# print(verify_password(correct_pwd, hashed_pwd))
# print(verify_password("hacker123", hashed_pwd))

token = create_acces_token(
  {
    "sub": "id123456",
    "role": "citizen"
  }
)

print(token)
print(decode_acces_token(token))
print(decode_acces_token(token + "x"))
print(decode_acces_token("garbage"))